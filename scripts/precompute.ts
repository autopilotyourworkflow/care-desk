/**
 * Runs the pipeline over every demo message and writes data/results.json (ResultsFile).
 *
 *   npm run precompute                    live, resumable: keeps saved results with the same versions and models
 *   npm run precompute -- --mock --allow-mock
 *                                         the deterministic mock client (no API key needed, models "mock"): a local
 *                                         SAMPLE only; npm run eval refuses it without --allow-mock. It will not
 *                                         overwrite results made by Claude unless you also pass --overwrite-live
 *   npm run precompute -- --limit 10      only the first 10 messages that need work
 *   npm run precompute -- --only MSG-0001 one message (comma-separate for several)
 *   npm run precompute -- --force         recompute everything selected, ignoring saved results
 *   npm run precompute -- --only MSG-0001,MSG-0002 --force --keep-others
 *                                         after a prompt change that can only affect those messages: re-run them and
 *                                         keep every other saved result as it is (each keeps its own prompts version).
 *                                         Needs the same rules version and models as the saved file
 *
 * Reads ANTHROPIC_API_KEY (and optional CARE_DESK_SORT_MODEL / CARE_DESK_DRAFT_MODEL) from the environment,
 * .env.local or .env.
 *
 * results.json keeps each message's own pipeline result. Patient-level safety (withdrawing every unsent reply to a
 * patient whose death is reported, and holding the drafts of a patient who reported something urgent) is derived when
 * the results are read: the desk queue does it in lib/fixtures/queue.ts, where a clinician can clear a false alarm,
 * and npm run eval checks it with applyPatientHolds and that same queue. This script prints what those holds cover.
 * Exits non-zero if any saved result came from the mock client, unless --allow-mock is passed.
 */
import type { Patient, PatientMessage, PipelineResult, ResultsFile, Usage } from "../lib/types";
import {
  LlmError,
  MODEL_CONFIG,
  applyPatientHolds,
  isHeldForPatient,
  isMockModel,
  isWithdrawn,
  PROMPTS_VERSION,
  RULES_VERSION,
  createClaudeClient,
  createMockClient,
  runPipeline,
  type LlmClient,
} from "../lib/pipeline";
import { getApiKey, getEnv } from "./lib/env";
import { asArray, dataPath, readJsonFile, readJsonIfExists, requireFile, writeJsonFile } from "./lib/io";
import { mapPool, sleep } from "./lib/pool";
import { scriptRecentMessages } from "./lib/recent";

const CONCURRENCY = 4;

const MAX_ATTEMPTS = 3;

interface Args {
  mock: boolean;
  allowMock: boolean;
  force: boolean;
  overwriteLive: boolean;
  /** With --only: keep every other saved result as it is, even under a new prompts version (same rules and models). */
  keepOthers: boolean;
  limit?: number;
  only?: Set<string>;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mock: false, allowMock: false, force: false, overwriteLive: false, keepOthers: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const eq = a.indexOf("=");
      if (eq >= 0) return a.slice(eq + 1);
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--mock") args.mock = true;
    else if (a === "--allow-mock") args.allowMock = true;
    else if (a === "--force") args.force = true;
    else if (a === "--overwrite-live") args.overwriteLive = true;
    else if (a === "--keep-others") args.keepOthers = true;
    else if (a.startsWith("--limit")) {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new Error("--limit must be a positive whole number");
      args.limit = n;
    } else if (a.startsWith("--only")) {
      args.only = new Set(value().split(",").map((s) => s.trim()).filter(Boolean));
    } else {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  return args;
}

/** Wraps a client so the script can tell a real AI failure (worth retrying) from a normal pipeline outcome. */
function tracked(inner: LlmClient): { client: LlmClient; failures: LlmError[] } {
  const failures: LlmError[] = [];
  const wrap =
    <A, R>(fn: (a: A) => Promise<R>) =>
    async (a: A): Promise<R> => {
      try {
        return await fn(a);
      } catch (err) {
        failures.push(err instanceof LlmError ? err : new LlmError("unavailable", String(err)));
        throw err;
      }
    };
  return {
    client: { sort: wrap((i) => inner.sort(i)), draft: wrap((i) => inner.draft(i)) },
    failures,
  };
}

function describe(r: PipelineResult): string {
  if (r.route === "draft") return "draft ready";
  if (r.route === "urgent") return "URGENT";
  if (r.route === "clinician") return "clinician";
  if (r.draft?.text && r.check && !r.check.passed) return "person (draft blocked by check)";
  if (r.draft?.declined) return "person (drafter declined)";
  return "person";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const messagesPath = dataPath("messages.json");
  const patientsPath = dataPath("patients.json");
  const resultsPath = dataPath("results.json");
  requireFile(messagesPath, "Write the demo messages first.");
  requireFile(patientsPath, "Write the demo patients first.");

  const messages = asArray<PatientMessage>(readJsonFile(messagesPath), "messages");
  const patients = asArray<Patient>(readJsonFile(patientsPath), "patients");
  const patientById = new Map(patients.map((p) => [p.id, p]));

  if (args.mock && !args.allowMock) {
    console.error(
      "A --mock run writes SAMPLE results from the mock sorter and drafter, not Claude, and they must never be published.\n" +
        "Pass --allow-mock as well for a local sample run, or run without --mock (ANTHROPIC_API_KEY in .env.local).",
    );
    process.exit(1);
  }

  let base: LlmClient;
  let models: ResultsFile["models"];
  if (args.mock) {
    base = createMockClient();
    models = { sort: "mock", draft: "mock" };
  } else {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.error("No ANTHROPIC_API_KEY found in the environment, .env.local or .env. Use --mock to run without one.");
      process.exit(1);
    }
    const sortModel = getEnv("CARE_DESK_SORT_MODEL") ?? MODEL_CONFIG.sortModel;
    const draftModel = getEnv("CARE_DESK_DRAFT_MODEL") ?? MODEL_CONFIG.draftModel;
    base = createClaudeClient(apiKey, { sortModel, draftModel, timeoutMs: 90_000 });
    models = { sort: sortModel, draft: draftModel };
  }
  const versions = { rules: RULES_VERSION, prompts: PROMPTS_VERSION };

  // Resume: keep saved results made with the same rules, prompts and models (and, for live runs, not an AI fallback).
  const existing = readJsonIfExists<ResultsFile>(resultsPath);

  // Guard: a mock run never silently replaces results that Claude produced.
  const existingIsLive = !!existing?.models && !isMockModel(existing.models.sort) && !isMockModel(existing.models.draft);
  if (args.mock && existingIsLive && !args.overwriteLive) {
    console.error(
      `data/results.json holds results from ${existing?.models.sort} / ${existing?.models.draft}. A --mock run would replace them with sample output.\n` +
        "Pass --overwrite-live as well if you really mean it, or write the sample somewhere else.",
    );
    process.exit(1);
  }
  if (args.mock) {
    console.warn(
      "!!! MOCK RUN: writing SAMPLE results from the mock sorter and drafter, not Claude. Do not publish them;\n" +
        "!!! npm run eval refuses them unless you pass --allow-mock. Rerun with a real key before any screen reads them.",
    );
  }
  const saved = new Map<string, PipelineResult>();
  if (existing?.results) for (const r of existing.results) saved.set(r.messageId, r);
  const sameSetup =
    !!existing &&
    existing.versions?.rules === versions.rules &&
    existing.versions?.prompts === versions.prompts &&
    existing.models?.sort === models.sort &&
    existing.models?.draft === models.draft;
  // --keep-others: only the prompts version may differ, and only the messages named with --only are run again.
  const keepOthers =
    args.keepOthers &&
    !!existing &&
    existing.versions?.rules === versions.rules &&
    existing.models?.sort === models.sort &&
    existing.models?.draft === models.draft;
  if (args.keepOthers && (!args.only || args.mock || !keepOthers)) {
    console.error(
      "--keep-others needs --only, a live run, and a saved file made with the same rules version and models. Nothing was run.",
    );
    process.exit(1);
  }
  const reusable = (m: PatientMessage) => {
    if (args.force || !sameSetup) return false;
    const r = saved.get(m.id);
    return !!r && r.versions.rules === versions.rules && r.versions.prompts === versions.prompts && r.mode === "live";
  };

  let todo = messages.filter((m) => (args.only ? args.only.has(m.id) : true)).filter((m) => !reusable(m));
  if (args.only) {
    const missing = [...args.only].filter((id) => !messages.some((m) => m.id === id));
    if (missing.length) console.warn(`Not in messages.json: ${missing.join(", ")}`);
  }
  if (args.limit !== undefined) todo = todo.slice(0, args.limit);

  console.log(
    `Care Desk precompute: ${messages.length} messages, ${todo.length} to run, ${args.mock ? "mock client" : `sort ${models.sort}, draft ${models.draft}`}, ${versions.rules} + ${versions.prompts}`,
  );
  if (keepOthers && !sameSetup) {
    console.log(`Keeping the other ${saved.size - todo.length} saved results as they are; each keeps its own prompts version.`);
  } else if (!sameSetup && existing && !args.force) {
    console.log("Saved results were made with a different setup, so they will be replaced.");
  }

  const fresh = new Map<string, PipelineResult>();
  const total: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let done = 0;
  let failed = 0;
  const started = Date.now();

  const save = () => {
    const results: PipelineResult[] = [];
    for (const m of messages) {
      const r = fresh.get(m.id) ?? (sameSetup || !existing || keepOthers ? saved.get(m.id) : undefined);
      if (r) results.push(r);
    }
    const file: ResultsFile = { generatedAt: new Date().toISOString(), versions, models, results };
    writeJsonFile(resultsPath, file);
    return results;
  };

  await mapPool(todo, CONCURRENCY, async (message) => {
    const patient = patientById.get(message.patientId);
    if (!patient) {
      failed++;
      console.error(`  ${message.id}: no patient ${message.patientId}, skipped`);
      return;
    }
    let result: PipelineResult | undefined;
    let lastFailure: LlmError | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { client, failures } = tracked(base);
      const t0 = Date.now();
      try {
        result = await runPipeline(message, patient, {
          llm: client,
          mode: "live",
          // The drafter sees the same patient's other recent desk messages (none for a red-team message, MSG-0901 onwards:
          // each red-team case stands alone; scripts/lib/recent.ts), and each open order's lateness as of this message.
          recentMessages: scriptRecentMessages(message, messages),
          recordsAsOf: message.receivedAt,
        });
      } catch (err) {
        // A deterministic module threw: not something a retry fixes.
        console.error(`  ${message.id}: pipeline error: ${err instanceof Error ? err.message : String(err)}`);
        result = undefined;
        break;
      }
      const retryable = failures.find((f) => f.kind === "unavailable" || f.kind === "invalid_output");
      if (!retryable || attempt === MAX_ATTEMPTS) {
        lastFailure = retryable;
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        done++;
        console.log(
          `[${String(done).padStart(3)}/${todo.length}] ${message.id} ${describe(result)}${result.holdOrders ? ", hold" : ""} ${secs}s $${result.usage.costUsd.toFixed(4)}${attempt > 1 ? ` (attempt ${attempt})` : ""}`,
        );
        break;
      }
      await sleep(1000 * 2 ** (attempt - 1));
    }
    if (!result) {
      failed++;
      return;
    }
    if (lastFailure) console.warn(`  ${message.id}: kept after ${MAX_ATTEMPTS} attempts: ${lastFailure.message}`);
    fresh.set(message.id, result);
    total.inputTokens += result.usage.inputTokens;
    total.outputTokens += result.usage.outputTokens;
    total.costUsd += result.usage.costUsd;
    if (fresh.size % 10 === 0) save();
  });

  const written = save();
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(
    `Wrote data/results.json: ${written.length} results (${fresh.size} new, ${failed} failed) in ${mins} min. Tokens in ${total.inputTokens}, out ${total.outputTokens}, cost $${total.costUsd.toFixed(4)}.`,
  );
  // Patient-level safety, derived (not written): what the desk and the eval will treat as withdrawn or held.
  // Desk slice only: the red-team slice (MSG-0901 onwards) is test input and never holds a desk patient's replies.
  const desk = (id: string) => id < "MSG-0901";
  const derived = applyPatientHolds(
    written.filter((r) => desk(r.messageId)),
    messages.filter((m) => desk(m.id)),
  );
  const withdrawn = derived.filter(isWithdrawn).length;
  const heldForPatient = derived.filter(isHeldForPatient).length;
  if (withdrawn || heldForPatient) {
    console.log(`Patient-level holds (derived when read): ${withdrawn} replies withdrawn because the patient may have died, ${heldForPatient} drafts held for a person.`);
  }
  if (failed > 0) process.exitCode = 1;

  // Release guard: no published result may come from the sample client.
  const mockResults = written.filter((r) => isMockModel(r.models.sort) || isMockModel(r.models.draft));
  if (mockResults.length > 0 && !args.allowMock) {
    console.error(
      `\n${mockResults.length} results came from the mock client (${mockResults.slice(0, 5).map((r) => r.messageId).join(", ")}${mockResults.length > 5 ? " ..." : ""}). ` +
        "They are samples, not Claude's output. Rerun with a real key, or pass --allow-mock for a local sample.",
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
