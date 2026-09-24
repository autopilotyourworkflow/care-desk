/**
 * The sample-case builder behind lib/fixtures/sample-results.json. It runs the REAL pipeline (redaction, safety
 * rules, retrieval, citation check and fact check) on four real demo messages. Only the sorter's verdict and the draft wording are scripted, so
 * the fixtures can never drift from the code or the data: policy ids, labels, record texts, rule ids, step titles,
 * summaries and versions all come from lib/pipeline and data/*.json.
 *
 * Regenerate after any change to the pipeline or the data:
 *   npx tsx lib/fixtures/build-samples.ts > lib/fixtures/sample-results.json
 * tests/fixtures.test.ts re-runs buildSamples() and fails when the committed JSON has drifted from it.
 *
 * The script fails loudly when a draft cites a source that retrieval no longer returns, or when a case no longer
 * lands on its intended route (for example the "blocked" draft passing the fact check).
 * Uses no Node-only APIs, so it runs in Node, in Vitest and in a Worker.
 */
import patientsData from "@/data/patients.json";
import messagesData from "@/data/messages.json";
import type { Draft, Patient, PatientMessage, PipelineResult, Route, SortResult, SourceRef } from "@/lib/types";
import { MODEL_CONFIG, costUsd, runPipeline, type LlmClient } from "@/lib/pipeline";

const patients = patientsData as unknown as Patient[];
const messages = messagesData as unknown as PatientMessage[];

interface Spec {
  key: "routine" | "blocked" | "clinical" | "urgent";
  label: string;
  messageId: string;
  expectRoute: Route;
  /** The sorter's verdict. Omit when the safety rules stop the message before any AI. */
  sort?: SortResult;
  /** Draft wording. cite("ORD-20004") returns that source's marker, e.g. "[1]". */
  draft?: (cite: (sourceId: string) => string) => string;
  /** Typical live timings for the AI steps, so the design review shows realistic numbers. */
  ms?: { sort: number; draft: number };
  tokens?: { sort: [number, number]; draft: [number, number] };
}

const SPECS: Spec[] = [
  {
    key: "routine",
    label: "Order status, checked draft",
    messageId: "MSG-0152",
    expectRoute: "draft",
    sort: {
      category: "order_status",
      risk: "routine",
      route: "draft",
      confidence: 0.96,
      reasons: ["Asks whether an order has shipped", "Quotes an order number on the account", "No clinical or safety words"],
      holdOrders: false,
    },
    // A chat (the first reply in it): no greeting line and no "Kind regards,", the name once in the first sentence, and
    // "[AGENT_NAME]" on its own line at the end, as draftFormatLine in lib/pipeline/prompts.ts asks for.
    draft: (cite) =>
      [
        `Yes, [FIRST_NAME], your order ORD-20004 shipped on 21 September 2026 with Courierline ${cite("ORD-20004")}. The tracking number is CD8801800721, and the estimated delivery date is 24 September 2026 ${cite("ORD-20004")}. If it has not arrived by then, reply here and the team will look into it.`,
        "[AGENT_NAME]",
      ].join("\n"),
    ms: { sort: 640, draft: 2310 },
    tokens: { sort: [1180, 96], draft: [2740, 168] },
  },
  {
    key: "blocked",
    label: "Price change, draft blocked by the fact check",
    messageId: "MSG-0023",
    expectRoute: "person",
    sort: {
      category: "price_change",
      risk: "routine",
      route: "draft",
      confidence: 0.93,
      reasons: ["Asks why the monthly price went up", "Two plan charges with different amounts", "No clinical or safety words"],
      holdOrders: false,
    },
    // "60 days" is the deliberate slip: the policy says at least 30 days' notice, so the fact check blocks the draft.
    draft: (cite) =>
      [
        "Hi [FIRST_NAME],",
        "",
        `Thanks for asking, and sorry the change came as a surprise. Your September charge of NZD 162.00 on 8 September 2026 ${cite("CHG-30077")} is the new price. Your August charge was NZD 149.00 ${cite("CHG-30076")}.`,
        "",
        `New Zealand plan prices changed on 1 September 2026, and we emailed patients about it on 31 July 2026, giving at least 60 days' notice ${cite("P5.4")}.`,
        "",
        "If you did not get that email, the team can check the email address on your account.",
        "",
        "Kind regards,",
        "[AGENT_NAME]",
      ].join("\n"),
    ms: { sort: 702, draft: 2544 },
    tokens: { sort: [1320, 104], draft: [3610, 182] },
  },
  {
    key: "clinical",
    label: "Medication question, stopped",
    messageId: "MSG-0127",
    expectRoute: "clinician",
  },
  {
    key: "urgent",
    label: "Bereavement reported, orders on hold",
    messageId: "MSG-0143",
    expectRoute: "urgent",
  },
];

function scriptedClient(spec: Spec): LlmClient {
  return {
    async sort() {
      if (!spec.sort) throw new Error(`${spec.key}: the sorter ran, but this case expects the rules to stop it`);
      const [i, o] = spec.tokens?.sort ?? [0, 0];
      const model = MODEL_CONFIG.sortModel;
      return { sort: spec.sort, model, usage: { inputTokens: i, outputTokens: o, costUsd: costUsd(model, { inputTokens: i, outputTokens: o }) } };
    },
    async draft(input) {
      if (!spec.draft) throw new Error(`${spec.key}: the drafter ran, but no draft is scripted`);
      const cite = (id: string) => {
        const i = input.sources.findIndex((s: SourceRef) => s.id === id);
        if (i < 0) throw new Error(`${spec.key}: the draft cites ${id}, which retrieval no longer returns (${input.sources.map((s) => s.id).join(", ")})`);
        return `[${i + 1}]`;
      };
      const draft: Draft = { text: spec.draft(cite), citations: [] };
      const [i, o] = spec.tokens?.draft ?? [0, 0];
      const model = MODEL_CONFIG.draftModel;
      return { draft, model, usage: { inputTokens: i, outputTokens: o, costUsd: costUsd(model, { inputTokens: i, outputTokens: o }) } };
    },
  };
}

async function build(spec: Spec): Promise<PipelineResult> {
  const message = messages.find((m) => m.id === spec.messageId);
  if (!message) throw new Error(`${spec.key}: message ${spec.messageId} not found`);
  const patient = patients.find((p) => p.id === message.patientId);
  if (!patient) throw new Error(`${spec.key}: patient ${message.patientId} not found`);
  const result = await runPipeline(message, patient, { llm: scriptedClient(spec) });
  if (result.route !== spec.expectRoute) {
    throw new Error(`${spec.key}: expected route ${spec.expectRoute}, got ${result.route} (${result.trail.map((s) => `${s.id}:${s.status}`).join(" ")})`);
  }
  // Deterministic, typical timings: the scripted AI answers instantly, and local steps take a few milliseconds.
  // Every step gets a fixed time (never a measured one), so the committed file cannot drift under load.
  const local: Record<string, number> = { redact: 4, rules: 2, sort: 3, sources: 9, draft: 3, check: 3, decide: 0 };
  for (const step of result.trail) {
    if (step.ms === undefined) continue;
    if (step.id === "sort") step.ms = spec.ms?.sort ?? local.sort;
    else if (step.id === "draft") step.ms = spec.ms?.draft ?? local.draft;
    else step.ms = local[step.id] ?? 0;
  }
  result.usage.costUsd = Math.round(result.usage.costUsd * 1e6) / 1e6;
  return result;
}

export const SAMPLES_NOTE = "Generated by lib/fixtures/build-samples.ts. Do not edit by hand.";

export interface SamplesFile {
  note: string;
  cases: { key: Spec["key"]; label: string; patientId: string; messageId: string; result: PipelineResult }[];
}

/** Runs the real pipeline on the four sample messages. The output is what sample-results.json must contain. */
export async function buildSamples(): Promise<SamplesFile> {
  const cases: SamplesFile["cases"] = [];
  for (const spec of SPECS) {
    const result = await build(spec);
    const message = messages.find((m) => m.id === spec.messageId)!;
    cases.push({ key: spec.key, label: spec.label, patientId: message.patientId, messageId: message.id, result });
  }
  return { note: SAMPLES_NOTE, cases };
}
