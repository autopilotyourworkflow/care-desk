/**
 * Rehearsal run without the API: Claude Code agents answer the exact sort and draft prompts the pipeline would send,
 * and every other step (redaction, safety rules, sources, fact check, patient holds, eval) runs unchanged.
 *
 *   npx tsx scripts/cc-run.ts plan      run the pipeline over every message with the saved answers; write the prompts
 *                                       still unanswered to cc-run/batches/, or cc-run/results.json when none are left
 *   npx tsx scripts/cc-run.ts check <answers file>
 *                                       an agent's self-check: shape, schema and keys against its batch
 *   npx tsx scripts/cc-run.ts import    merge cc-run/answers/*.json into cc-run/answers.json (shape-checked)
 *   npx tsx scripts/cc-run.ts status    counts only
 *   npx tsx scripts/cc-run.ts review [--parts 3]
 *                                       reviewer packets in cc-run/review/ (routing mismatches, draft slices)
 *   npx tsx scripts/eval.ts --results cc-run/results.json --report cc-run/eval-report.json
 *                                       score the rehearsal without touching data/
 *
 * Nothing here reads an API key or opens a network connection. Every answer is keyed by a hash of the system prompt
 * and the user prompt, so a prompt change re-asks only the messages whose prompts changed. An answer that fails the
 * pipeline's own validation (word count, source markers) is kept as a real model failure and re-asked, up to the
 * same 3 attempts npm run precompute makes against the API. Results are labelled "claude-code/<model>" and live
 * only in cc-run/ (gitignored): they are a rehearsal, never published.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Patient, PatientMessage, PipelineResult, ResultsFile, TestLabel, Usage } from "../lib/types";
import {
  DRAFT_SCHEMA,
  DRAFT_SYSTEM_PROMPT,
  SORT_SCHEMA,
  SORT_SYSTEM_PROMPT,
  buildDraftUserPrompt,
  buildSortUserPrompt,
} from "../lib/pipeline/prompts";
import { LlmError, validateDraft, validateSort, type LlmClient } from "../lib/pipeline/llm";
import { PROMPTS_VERSION, RULES_VERSION, applyPatientHolds, resultCategory, runPipeline } from "../lib/pipeline";
import { costUsd } from "../lib/pipeline/pricing";
import { ROOT, asArray, dataPath, readJsonFile, readJsonIfExists, writeJsonFile } from "./lib/io";
import { mapPool } from "./lib/pool";
import { scriptRecentMessages } from "./lib/recent";
import { reviewCases } from "./lib/review-cases";

type Kind = "sort" | "draft";

/** The production models these agents stand in for (sort on Haiku 4.5; draft on Opus 5.5, the default in MODEL_CONFIG). */
export const CC_MODELS = { sort: "claude-haiku-4-5", draft: "claude-opus-5-5" } as const;
const LABEL = (kind: Kind) => `claude-code/${CC_MODELS[kind]}`;
const MAX_ATTEMPTS = 3;

const DIR = join(ROOT, "cc-run");
const P = {
  prompts: join(DIR, "prompts"),
  batches: join(DIR, "batches"),
  answers: join(DIR, "answers"),
  store: join(DIR, "answers.json"),
  results: join(DIR, "results.json"),
  plan: join(DIR, "plan.json"),
};

const SYSTEM: Record<Kind, string> = { sort: SORT_SYSTEM_PROMPT, draft: DRAFT_SYSTEM_PROMPT };
const SCHEMA: Record<Kind, typeof SORT_SCHEMA | typeof DRAFT_SCHEMA> = { sort: SORT_SCHEMA, draft: DRAFT_SCHEMA };

export function answerKey(kind: Kind, user: string): string {
  return createHash("sha256").update(`${kind}\n${SYSTEM[kind]}\n---\n${user}`).digest("hex").slice(0, 20);
}

interface Attempt {
  output: unknown;
  batch: string;
}
type Store = Record<string, { kind: Kind; messageId: string; attempts: Attempt[] }>;

interface BatchItem {
  key: string;
  messageId: string;
  /** How many earlier answers the pipeline rejected (0 on the first ask). */
  retry: number;
  user: string;
}
interface Batch {
  kind: Kind;
  batch: string;
  systemPromptFile: string;
  schemaFile: string;
  answersFile: string;
  items: BatchItem[];
}

// ---------- Schema shape check (what structured outputs guarantee on the API; a miss here is a harness error) ----------

type JsonSchema = {
  type?: string;
  enum?: readonly unknown[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
};

export function shapeErrors(value: unknown, schema: JsonSchema, path = "output"): string[] {
  const errs: string[] = [];
  const t = schema.type;
  if (t === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path} is not an object`];
    const obj = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in obj)) errs.push(`${path}.${r} is missing`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (!sub) {
        if (schema.additionalProperties === false) errs.push(`${path}.${k} is not allowed`);
        continue;
      }
      errs.push(...shapeErrors(v, sub, `${path}.${k}`));
    }
    return errs;
  }
  if (t === "array") {
    if (!Array.isArray(value)) return [`${path} is not an array`];
    value.forEach((v, i) => errs.push(...shapeErrors(v, schema.items ?? {}, `${path}[${i}]`)));
    return errs;
  }
  if (t === "string" && typeof value !== "string") return [`${path} is not a string`];
  if (t === "number" && (typeof value !== "number" || !Number.isFinite(value))) return [`${path} is not a number`];
  if (t === "boolean" && typeof value !== "boolean") return [`${path} is not true or false`];
  if (schema.enum && !schema.enum.includes(value)) return [`${path} is not one of ${schema.enum.join(", ")}`];
  return errs;
}

// ---------- The replay client ----------

interface Pending {
  kind: Kind;
  key: string;
  messageId: string;
  retry: number;
  user: string;
}

/** Rough token estimate for the cost column (about 4 characters a token). Marked as an estimate in the summary. */
function estUsage(kind: Kind, user: string, outChars: number): Usage {
  const inputTokens = Math.ceil((SYSTEM[kind].length + user.length) / 4);
  const outputTokens = Math.ceil(outChars / 4) + (kind === "draft" ? 400 : 20);
  return { inputTokens, outputTokens, costUsd: costUsd(CC_MODELS[kind], { inputTokens, outputTokens }) };
}

function replayClient(messageId: string, store: Store, pending: Pending[]): LlmClient {
  const answer = (kind: Kind, user: string): { output: unknown; attempts: number } | { missing: true; retry: number } => {
    const key = answerKey(kind, user);
    const entry = store[key];
    const attempts = entry?.attempts ?? [];
    // Use the first attempt the pipeline accepts, as a precompute retry would.
    for (const a of attempts) {
      const ok = kind === "sort" ? typeof validateSort(a.output) !== "string" : true;
      if (ok) return { output: a.output, attempts: attempts.length };
    }
    if (attempts.length === 0) {
      pending.push({ kind, key, messageId, retry: 0, user });
      return { missing: true, retry: 0 };
    }
    return { output: attempts[attempts.length - 1].output, attempts: attempts.length };
  };

  return {
    async sort(input) {
      const user = buildSortUserPrompt(input);
      const a = answer("sort", user);
      if ("missing" in a) throw new LlmError("unavailable", "No Claude Code answer yet", { model: LABEL("sort") });
      const usage = estUsage("sort", user, JSON.stringify(a.output).length);
      const sort = validateSort(a.output);
      if (typeof sort === "string") {
        if (a.attempts < MAX_ATTEMPTS) pending.push({ kind: "sort", key: answerKey("sort", user), messageId, retry: a.attempts, user });
        throw new LlmError("invalid_output", `The sort answer was invalid: ${sort}`, { usage, model: LABEL("sort") });
      }
      return { sort, usage, model: LABEL("sort") };
    },
    async draft(input) {
      const user = buildDraftUserPrompt(input);
      const key = answerKey("draft", user);
      const attempts = store[key]?.attempts ?? [];
      if (attempts.length === 0) {
        pending.push({ kind: "draft", key, messageId, retry: 0, user });
        throw new LlmError("unavailable", "No Claude Code answer yet", { model: LABEL("draft") });
      }
      // First attempt the pipeline accepts; otherwise the latest, re-asked while attempts remain.
      let last: string | undefined;
      for (const at of attempts) {
        const d = validateDraft(at.output, input.sources);
        if (typeof d !== "string") {
          const usage = estUsage("draft", user, JSON.stringify(at.output).length);
          return { draft: d, usage, model: LABEL("draft") };
        }
        last = d;
      }
      if (attempts.length < MAX_ATTEMPTS) pending.push({ kind: "draft", key, messageId, retry: attempts.length, user });
      const usage = estUsage("draft", user, JSON.stringify(attempts[attempts.length - 1].output).length);
      throw new LlmError("invalid_output", `The draft was invalid: ${last}`, { usage, model: LABEL("draft") });
    },
  };
}

// ---------- Commands ----------

function loadData() {
  const messages = asArray<PatientMessage>(readJsonFile(dataPath("messages.json")), "messages");
  const patients = asArray<Patient>(readJsonFile(dataPath("patients.json")), "patients");
  return { messages, patients: new Map(patients.map((p) => [p.id, p])) };
}

function loadStore(): Store {
  return readJsonIfExists<Store>(P.store) ?? {};
}

function writePrompts() {
  mkdirSync(P.prompts, { recursive: true });
  for (const kind of ["sort", "draft"] as Kind[]) {
    writeFileSync(join(P.prompts, `${kind}-system.txt`), SYSTEM[kind], "utf8");
    writeJsonFile(join(P.prompts, `${kind}-schema.json`), SCHEMA[kind]);
  }
}

function argValue(argv: string[], flag: string, fallback: number): number {
  const i = argv.indexOf(flag);
  const n = i >= 0 ? Number(argv[i + 1]) : fallback;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

async function plan(argv: string[]) {
  const sortBatch = argValue(argv, "--sort-batch", 12);
  const draftBatch = argValue(argv, "--draft-batch", 6);
  // Import first: the batch folder is rebuilt below, and an answers file is only read against its own batch.
  if (existsSync(P.batches)) importAnswers();
  const { messages, patients } = loadData();
  const store = loadStore();
  const pending: Pending[] = [];
  const results = new Map<string, PipelineResult>();

  await mapPool(messages, 8, async (m) => {
    const patient = patients.get(m.patientId);
    if (!patient) throw new Error(`${m.id}: no patient ${m.patientId}`);
    const r = await runPipeline(m, patient, {
      llm: replayClient(m.id, store, pending),
      mode: "live",
      // As npm run precompute: the same patient's recent desk messages (none for a red-team message), and order lateness.
      recentMessages: scriptRecentMessages(m, messages),
      recordsAsOf: m.receivedAt,
    });
    results.set(m.id, r);
  });

  writePrompts();
  // Fresh batch folder each plan; answers already imported are in the store.
  if (existsSync(P.batches)) rmSync(P.batches, { recursive: true, force: true });
  mkdirSync(P.batches, { recursive: true });
  mkdirSync(P.answers, { recursive: true });

  const unique = new Map<string, Pending>();
  for (const p of pending) if (!unique.has(p.key)) unique.set(p.key, p);
  const byKind = (k: Kind) => [...unique.values()].filter((p) => p.kind === k).sort((a, b) => a.messageId.localeCompare(b.messageId));
  const batches: Batch[] = [];
  // Number new batches after every batch that ever had an answers file, so a new name never meets an old answer.
  let n = readdirSync(P.answers)
    .map((f) => Number(f.match(/-(\d+)\.json$/)?.[1] ?? 0))
    .reduce((a, b) => Math.max(a, b), 0);
  for (const kind of ["sort", "draft"] as Kind[]) {
    const items = byKind(kind);
    const size = kind === "sort" ? sortBatch : draftBatch;
    for (let i = 0; i < items.length; i += size) {
      n++;
      const name = `${kind}-${String(n).padStart(3, "0")}`;
      const batch: Batch = {
        kind,
        batch: name,
        systemPromptFile: join(P.prompts, `${kind}-system.txt`),
        schemaFile: join(P.prompts, `${kind}-schema.json`),
        answersFile: join(P.answers, `${name}.json`),
        items: items.slice(i, i + size).map(({ key, messageId, retry, user }) => ({ key, messageId, retry, user })),
      };
      writeJsonFile(join(P.batches, `${name}.json`), batch);
      batches.push(batch);
    }
  }

  const summary = {
    messages: messages.length,
    pendingSort: byKind("sort").length,
    pendingDraft: byKind("draft").length,
    batches: batches.map((b) => ({ file: join(P.batches, `${b.batch}.json`), kind: b.kind, items: b.items.length })),
    complete: unique.size === 0,
  };
  writeJsonFile(P.plan, summary);

  if (unique.size === 0) {
    const ordered = messages.map((m) => results.get(m.id)!).filter(Boolean);
    const file: ResultsFile = {
      generatedAt: new Date().toISOString(),
      versions: { rules: RULES_VERSION, prompts: PROMPTS_VERSION },
      models: { sort: LABEL("sort"), draft: LABEL("draft") },
      results: ordered,
    };
    writeJsonFile(P.results, file);
    const desk = (id: string) => id < "MSG-0901";
    const derived = applyPatientHolds(ordered.filter((r) => desk(r.messageId)), messages.filter((m) => desk(m.id)));
    const cost = ordered.reduce((s, r) => s + r.usage.costUsd, 0);
    const routes = ordered.reduce<Record<string, number>>((acc, r) => ((acc[r.route] = (acc[r.route] ?? 0) + 1), acc), {});
    console.log(`Complete: wrote cc-run/results.json (${ordered.length} results).`);
    console.log(`Routes: ${Object.entries(routes).map(([k, v]) => `${k} ${v}`).join(", ")}. Desk results after patient holds: ${derived.length}.`);
    console.log(`Estimated API cost of the same run: about US$${cost.toFixed(2)} (4 characters a token; an estimate, not a bill).`);
  } else {
    console.log(
      `Pending: ${summary.pendingSort} sort and ${summary.pendingDraft} draft prompts in ${batches.length} batches (cc-run/batches/). ` +
        "Answer them, then run import and plan again.",
    );
  }
}

function readAnswers(file: string): { key: string; output: unknown }[] | string {
  const raw = readJsonIfExists<unknown>(file);
  if (raw === undefined) return "not valid JSON (or missing)";
  const list = Array.isArray(raw) ? raw : (raw as { answers?: unknown })?.answers;
  if (!Array.isArray(list)) return 'expected { "answers": [ { "key", "output" } ] }';
  const out: { key: string; output: unknown }[] = [];
  for (const [i, a] of list.entries()) {
    if (!a || typeof a !== "object" || typeof (a as { key?: unknown }).key !== "string") return `answers[${i}] has no key`;
    out.push({ key: (a as { key: string }).key, output: (a as { output?: unknown }).output });
  }
  return out;
}

/** Validates one answers file against its batch. Returns the problems (empty when it is good to import). */
export function checkAnswers(batch: Batch, answers: { key: string; output: unknown }[] | string): string[] {
  if (typeof answers === "string") return [answers];
  const errs: string[] = [];
  const want = new Set(batch.items.map((i) => i.key));
  const seen = new Set<string>();
  for (const a of answers) {
    if (!want.has(a.key)) errs.push(`${a.key}: not a key in ${batch.batch}`);
    if (seen.has(a.key)) errs.push(`${a.key}: answered twice`);
    seen.add(a.key);
    for (const e of shapeErrors(a.output, SCHEMA[batch.kind] as JsonSchema)) errs.push(`${a.key}: ${e}`);
  }
  for (const k of want) if (!seen.has(k)) errs.push(`${k}: no answer`);
  return errs;
}

function batchFor(answersFile: string): Batch | undefined {
  const name = basename(answersFile, ".json");
  return readJsonIfExists<Batch>(join(P.batches, `${name}.json`));
}

function check(file: string) {
  const batch = batchFor(file);
  if (!batch) {
    console.error(`No batch named ${basename(file, ".json")} in cc-run/batches/.`);
    process.exit(1);
  }
  const errs = checkAnswers(batch, readAnswers(file));
  if (errs.length) {
    console.error(`NOT OK (${errs.length} problems):\n${errs.slice(0, 40).map((e) => `  ${e}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`OK: ${batch.items.length} answers match ${batch.batch} and its schema.`);
}

function importAnswers() {
  const store = loadStore();
  if (!existsSync(P.answers)) {
    console.log("No cc-run/answers/ folder yet.");
    return;
  }
  let added = 0;
  const rejected: string[] = [];
  for (const f of readdirSync(P.answers).filter((x) => x.endsWith(".json")).sort()) {
    const file = join(P.answers, f);
    const batch = batchFor(file);
    if (!batch) continue; // an older plan's file, already imported
    const answers = readAnswers(file);
    const errs = checkAnswers(batch, answers);
    const bad = new Set(errs.map((e) => e.split(":")[0]));
    if (typeof answers === "string") {
      rejected.push(`${f}: ${answers}`);
      continue;
    }
    const itemByKey = new Map(batch.items.map((i) => [i.key, i]));
    for (const a of answers) {
      if (bad.has(a.key) || !itemByKey.has(a.key)) continue;
      const item = itemByKey.get(a.key)!;
      const entry = (store[a.key] ??= { kind: batch.kind, messageId: item.messageId, attempts: [] });
      if (entry.attempts.some((x) => x.batch === batch.batch)) continue;
      entry.attempts.push({ output: a.output, batch: batch.batch });
      added++;
    }
    if (errs.length) rejected.push(`${f}: ${errs.length} answers not imported (${errs.slice(0, 3).join("; ")})`);
  }
  writeJsonFile(P.store, store);
  console.log(`Imported ${added} answers into cc-run/answers.json (${Object.keys(store).length} prompts answered in all).`);
  if (rejected.length) console.warn(`Rejected (re-ask these on the next plan):\n${rejected.map((r) => `  ${r}`).join("\n")}`);
}

/**
 * Writes reviewer packets from cc-run/results.json: routing.json (every case the eval scores as a route or category
 * difference, with the rule hits and the sorter's answer) and drafts-<n>.json (every draft or decline, split in `--parts`
 * slices, with the message, the numbered sources, the draft and the fact check).
 *
 * routing.json is built from the same cases scripts/eval.ts scores (scripts/lib/review-cases.ts): the patient-level
 * result after applyPatientHolds and the label adjusted for the patient's other messages, so a reviewer sees the same
 * differences the eval reports. Each entry also keeps the message's own result (ownResult) and, when it was adjusted,
 * the label as written (labelAsWritten) and why (patientLevel).
 */
function review(argv: string[]) {
  const parts = argValue(argv, "--parts", 3);
  const file = readJsonIfExists<ResultsFile>(P.results);
  if (!file) {
    console.error("No cc-run/results.json yet: run plan until it says Complete.");
    process.exit(1);
  }
  const labels = asArray<TestLabel>(readJsonFile(dataPath("testset.json")), "cases");
  const { messages, patients } = loadData();
  const countryOf = new Map(messages.map((m) => [m.id, patients.get(m.patientId)?.country]));
  const dir = join(DIR, "review");
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const { cases } = reviewCases(file.results, messages, labels);
  const routing = cases
    .filter((c) => !c.routeCorrect || !c.categoryCorrect)
    .map((c) => {
      const own = c.ownResult;
      const adjusted = c.label !== c.labelAsWritten;
      const changed = c.result !== own;
      return {
        messageId: c.messageId,
        expected: c.label,
        got: c.got,
        ...(adjusted ? { labelAsWritten: c.labelAsWritten } : {}),
        ownResult: { route: own.route, category: resultCategory(own), holdOrders: own.holdOrders },
        ...(adjusted || changed
          ? {
              patientLevel: {
                withdrawnFor: c.withdraw ?? null,
                heldFor: c.heldFor ?? null,
                decide: changed ? (c.result.trail?.find((s) => s.id === "decide")?.summary ?? null) : null,
              },
            }
          : {}),
        ruleHits: own.rules.hits.map((h) => `${h.ruleId}: "${h.phrase}"`),
        sorter: own.sort ?? null,
        draftBlocked: !!own.draft?.text && own.check ? !own.check.passed : false,
        message: own.redactedText,
      };
    });
  writeJsonFile(join(dir, "routing.json"), routing);

  const drafted = file.results.filter((r) => r.draft && (r.draft.text || r.draft.declined));
  const packets = drafted.map((r) => ({
    messageId: r.messageId,
    country: countryOf.get(r.messageId),
    category: r.sort?.category,
    route: r.route,
    message: r.redactedText,
    sources: [...(r.sources?.records ?? []), ...(r.sources?.policy ?? [])].map((s, i) => ({ n: i + 1, id: s.id, label: s.label, text: s.text })),
    draft: r.draft?.text ?? "",
    declined: r.draft?.declined ?? "",
    check: r.check ? { passed: r.check.passed, banned: r.check.banned, unmatched: r.check.facts.filter((f) => !f.found).map((f) => f.text) } : null,
  }));
  for (let k = 0; k < parts; k++) {
    writeJsonFile(join(dir, `drafts-${k + 1}.json`), packets.filter((_, i) => i % parts === k));
  }
  console.log(`Wrote cc-run/review/: routing.json (${routing.length} mismatches) and ${parts} draft slices (${packets.length} drafts or declines).`);
}

function status() {
  const store = loadStore();
  const plan = readJsonIfExists<{ pendingSort: number; pendingDraft: number; complete: boolean }>(P.plan);
  const kinds = Object.values(store).reduce<Record<string, number>>((a, e) => ((a[e.kind] = (a[e.kind] ?? 0) + 1), a), {});
  console.log(JSON.stringify({ answered: kinds, lastPlan: plan ?? null }, null, 2));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "plan") return plan(rest);
  if (cmd === "check") return check(rest[0]);
  if (cmd === "import") return importAnswers();
  if (cmd === "status") return status();
  if (cmd === "review") return review(rest);
  console.error("Usage: npx tsx scripts/cc-run.ts plan | check <answers file> | import | status | review");
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
