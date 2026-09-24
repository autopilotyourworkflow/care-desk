import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Category, CheckResult, Draft, Patient, PatientMessage, PipelineResult, RuleHit, SortResult, SourceRef, TrailStep } from "@/lib/types";

// The deterministic modules are replaced with controllable fakes, so these tests pin down the orchestrator's routing
// logic on its own. Redaction stays real, to prove the AI never sees the patient's details. With h.real = true the
// fakes pass through to the real rules, retrieval and fact check, for the tests that run the demo data end to end.
const h = vi.hoisted(() => ({
  real: false,
  hits: [] as RuleHit[],
  records: [] as SourceRef[],
  policy: [] as SourceRef[],
  check: { facts: [], banned: [], passed: true } as CheckResult,
  recordCalls: [] as { category: string; text?: string }[],
}));

vi.mock("@/lib/pipeline/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/rules")>();
  return {
    ...actual,
    RULES_VERSION: "rules-test",
    checkRules: (text: string) => {
      if (h.real) return actual.checkRules(text);
      const hits = h.hits.filter((x) => text.includes(x.phrase));
      return { matched: hits.some((x) => x.category !== "stop_sending"), hits };
    },
    routeForHits: (hits: RuleHit[]) => {
      if (h.real) return actual.routeForHits(hits);
      const cats = new Set(hits.map((x) => x.category));
      if (["crisis", "adverse_event", "bereavement"].some((c) => cats.has(c as RuleHit["category"])))
        return { route: "urgent", holdOrders: true };
      if (cats.has("clinical_question") || cats.has("side_effect")) return { route: "clinician", holdOrders: false };
      return null;
    },
  };
});
vi.mock("@/lib/pipeline/retrieve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/retrieve")>();
  return {
    ...actual,
    selectRecords: (...args: Parameters<typeof actual.selectRecords>) => {
      h.recordCalls.push({ category: args[1], text: args[2] });
      return h.real ? actual.selectRecords(...args) : h.records;
    },
    searchPolicy: (...args: Parameters<typeof actual.searchPolicy>) => (h.real ? actual.searchPolicy(...args) : h.policy),
  };
});
vi.mock("@/lib/pipeline/check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/check")>();
  return {
    ...actual,
    checkDraft: (...args: Parameters<typeof actual.checkDraft>) => (h.real ? actual.checkDraft(...args) : h.check),
  };
});

import {
  runPipeline,
  applyPatientHolds,
  isHeldForPatient,
  isReadyToSend,
  isWithdrawn,
  safetyProtocolIds,
  isStopped,
  isDemoMode,
  STEP_ORDER,
  STEP_TITLES,
  messageText,
  headlineCategory,
  headlineHit,
  looksNonEnglish,
  resultCategory,
  SAMPLE_RUN_NOTE,
} from "@/lib/pipeline/run";
import {
  LlmError,
  createMockClient,
  validateSort,
  validateDraft,
  sanitizeDashes,
  extractCitations,
  type LlmClient,
  type SortInput,
  type DraftInput,
} from "@/lib/pipeline/llm";
import { PROMPTS_VERSION, buildDraftUserPrompt } from "@/lib/pipeline/prompts";
import { falseAlarmKeepsAlert, isLivingPatientReport, reportsPatientDeath } from "@/lib/pipeline/death";
import { STEP_LABEL } from "@/lib/format";
import { selectRecords, searchPolicy } from "@/lib/pipeline/retrieve";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";
import { costUsd } from "@/lib/pipeline/pricing";

const patient: Patient = {
  id: "PT-1001",
  firstName: "Maeve",
  lastName: "Thornbury",
  email: "maeve.thornbury@example.com",
  phone: "0412 345 678",
  dob: "1984-03-12",
  address: { line1: "14 Wattle Street", suburb: "Brunswick", region: "VIC", postcode: "3056", country: "AU" },
  country: "AU",
  timezone: "Australia/Melbourne",
  plan: { name: "Monthly treatment plan", monthlyPrice: 149, currency: "AUD", status: "active", startedAt: "2026-01-10" },
  orders: [],
  charges: [],
  appointments: [],
};

const msg = (body: string, extra: Partial<PatientMessage> = {}): PatientMessage => ({
  id: "MSG-0001",
  patientId: "PT-1001",
  channel: "email",
  receivedAt: "2026-09-22T10:00:00+10:00",
  body,
  ...extra,
});

const ORDER: SourceRef = {
  id: "ORD-20481",
  kind: "order",
  label: "Order ORD-20481, shipped 18 Sep",
  text: "Order ORD-20481 shipped on 18 Sep 2026 with Courierline, tracking CD4829103756.",
};
const POLICY: SourceRef = {
  id: "P3.2",
  kind: "policy",
  label: "Delivery times",
  text: "Metro deliveries in Australia usually take 2 to 4 business days.",
};

const routineSort = (over: Partial<SortResult> = {}): SortResult => ({
  category: "order_status",
  risk: "routine",
  route: "draft",
  confidence: 0.92,
  reasons: ["Asks where the order is"],
  holdOrders: false,
  ...over,
});

const goodDraft: Draft = {
  text: "Hi [FIRST_NAME],\n\nYour order ORD-20481 shipped on 18 Sep 2026 [1]. Deliveries usually take 2 to 4 business days [2].\n\nKind regards,\n[AGENT_NAME]",
  citations: [],
};

function fakeLlm(opts: { sort?: SortResult | LlmError; draft?: Draft | LlmError; model?: string } = {}) {
  const calls = { sort: [] as SortInput[], draft: [] as DraftInput[] };
  const usage = { inputTokens: 100, outputTokens: 20, costUsd: 0.001 };
  const client: LlmClient = {
    async sort(input) {
      calls.sort.push(input);
      const s = opts.sort ?? routineSort();
      if (s instanceof LlmError) throw s;
      return { sort: s, usage, model: opts.model ?? "fake-sort" };
    },
    async draft(input) {
      calls.draft.push(input);
      const d = opts.draft ?? goodDraft;
      if (d instanceof LlmError) throw d;
      return { draft: d, usage, model: opts.model ?? "fake-draft" };
    },
  };
  return { client, calls };
}

const statuses = (trail: TrailStep[]) => Object.fromEntries(trail.map((s) => [s.id, s.status]));

beforeEach(() => {
  h.real = false;
  h.recordCalls = [];
  h.hits = [];
  h.records = [ORDER];
  h.policy = [POLICY];
  h.check = { facts: [{ text: "18 Sep 2026", kind: "date", found: true, sourceId: "ORD-20481" }], banned: [], passed: true };
});

describe("runPipeline: happy path", () => {
  it("drafts a routine message, maps citations, and waits for a person", async () => {
    const { client, calls } = fakeLlm();
    const r = await runPipeline(msg("Hi, where is my order? Thanks, Maeve"), patient, { llm: client });
    expect(r.route).toBe("draft");
    expect(r.holdOrders).toBe(false);
    expect(r.trail.map((s) => s.id)).toEqual([...STEP_ORDER]);
    expect(statuses(r.trail)).toEqual({
      redact: "passed",
      rules: "passed",
      sort: "passed",
      sources: "passed",
      draft: "passed",
      check: "passed",
      decide: "pending",
    });
    expect(r.trail[6].summary).toBe("Waiting for a person to send, edit or escalate");
    expect(r.draft?.citations).toEqual([
      { marker: "[1]", sourceId: "ORD-20481" },
      { marker: "[2]", sourceId: "P3.2" },
    ]);
    expect(calls.draft[0].sources.map((s) => s.id)).toEqual(["ORD-20481", "P3.2"]);
    expect(r.usage.inputTokens).toBe(200);
    expect(r.usage.costUsd).toBeCloseTo(0.002);
    expect(r.models).toEqual({ sort: "fake-sort", draft: "fake-draft" });
    expect(r.versions).toEqual({ rules: "rules-test", prompts: PROMPTS_VERSION });
    expect(r.mode).toBe("live");
    expect(isStopped(r)).toBe(false);
  });

  it("never shows the AI the patient's name or email", async () => {
    const { client, calls } = fakeLlm();
    await runPipeline(
      msg("Where is my order? You can reach me at maeve.thornbury@example.com. Maeve Thornbury", {
        subject: "Order for Maeve",
      }),
      patient,
      { llm: client },
    );
    const seen = calls.sort[0].text + calls.draft[0].text;
    expect(seen).not.toMatch(/Maeve|Thornbury|maeve\.thornbury@example\.com/);
  });
});

describe("runPipeline: safety stops", () => {
  it("a rule hit stops the trail before the AI, routes urgent and holds orders", async () => {
    h.hits = [{ ruleId: "crisis.self_harm", category: "crisis", phrase: "hurt myself", start: 0, end: 0 }];
    const { client, calls } = fakeLlm();
    const text = "I just want to hurt myself, nothing helps";
    const r = await runPipeline(msg(text), patient, { llm: client });
    expect(calls.sort).toHaveLength(0);
    expect(calls.draft).toHaveLength(0);
    expect(r.route).toBe("urgent");
    expect(r.holdOrders).toBe(true);
    expect(r.rules.matched).toBe(true);
    expect(r.sort).toBeUndefined();
    expect(r.draft).toBeUndefined();
    expect(statuses(r.trail)).toEqual({
      redact: "passed",
      rules: "stopped",
      sort: "skipped",
      sources: "skipped",
      draft: "skipped",
      check: "skipped",
      decide: "pending",
    });
    expect(r.trail.map((s) => s.id)).toEqual([...STEP_ORDER]);
    expect(isStopped(r)).toBe(true);
    expect(r.trail[6].summary).toMatch(/clinician/);
  });

  it("a clinical rule hit routes to a clinician without a hold", async () => {
    h.hits = [{ ruleId: "clinical.dose", category: "clinical_question", phrase: "how much", start: 0, end: 0 }];
    const { client } = fakeLlm();
    const r = await runPipeline(msg("how much should I take at night?"), patient, { llm: client });
    expect(r.route).toBe("clinician");
    expect(r.holdOrders).toBe(false);
    expect(r.trail[1].status).toBe("stopped");
  });

  it("a safety hit in an earlier patient message in the thread also stops the trail", async () => {
    h.hits = [{ ruleId: "adverse.hospital", category: "adverse_event", phrase: "ended up in hospital", start: 0, end: 0 }];
    const { client, calls } = fakeLlm();
    const r = await runPipeline(
      msg("Any update on my order?", {
        thread: [{ from: "patient", at: "2026-09-20T09:00:00+10:00", body: "I ended up in hospital last night" }],
      }),
      patient,
      { llm: client },
    );
    expect(calls.sort).toHaveLength(0);
    expect(r.route).toBe("urgent");
    expect(r.holdOrders).toBe(true);
    expect(r.rules.hits[0].start).toBe(-1);
    expect(r.trail[1].summary).toMatch(/earlier message/);
  });

  it("the sorter can escalate on its own: side effect goes to a clinician", async () => {
    const { client, calls } = fakeLlm({
      sort: routineSort({ category: "side_effect", risk: "clinical", route: "clinician", confidence: 0.8 }),
    });
    const r = await runPipeline(msg("my receipt looks wrong and I feel a bit off since the new bottle"), patient, {
      llm: client,
    });
    expect(calls.draft).toHaveLength(0);
    expect(r.route).toBe("clinician");
    expect(statuses(r.trail)).toMatchObject({ rules: "passed", sort: "stopped", sources: "skipped", draft: "skipped", check: "skipped" });
    expect(isStopped(r)).toBe(true);
  });

  it("the sorter escalating to urgent always holds orders", async () => {
    const { client } = fakeLlm({
      sort: routineSort({ category: "bereavement", risk: "urgent", route: "urgent", holdOrders: false }),
    });
    const r = await runPipeline(msg("Writing on behalf of my late mother"), patient, { llm: client });
    expect(r.route).toBe("urgent");
    expect(r.holdOrders).toBe(true);
  });

  it("a safety category with an inconsistent draft route is still escalated", async () => {
    const { client, calls } = fakeLlm({
      sort: routineSort({ category: "clinical_question", risk: "routine", route: "draft", confidence: 0.99 }),
    });
    const r = await runPipeline(msg("can I drive after taking it"), patient, { llm: client });
    expect(calls.draft).toHaveLength(0);
    expect(r.route).toBe("clinician");
  });
});

describe("runPipeline: routes to a person", () => {
  it("low confidence goes to a person, with sources kept as context", async () => {
    const { client, calls } = fakeLlm({ sort: routineSort({ confidence: 0.6 }) });
    const r = await runPipeline(msg("hey so about the thing"), patient, { llm: client });
    expect(calls.draft).toHaveLength(0);
    expect(r.route).toBe("person");
    expect(statuses(r.trail)).toMatchObject({ sort: "flagged", sources: "passed", draft: "skipped", check: "skipped" });
    expect(r.sources?.records).toHaveLength(1);
  });

  it("respects a custom confidence threshold", async () => {
    const { client } = fakeLlm({ sort: routineSort({ confidence: 0.8 }) });
    const r = await runPipeline(msg("where is my order"), patient, { llm: client, confidenceThreshold: 0.85 });
    expect(r.route).toBe("person");
  });

  it("wants_human always goes to a person even if the sorter says draft", async () => {
    const { client, calls } = fakeLlm({ sort: routineSort({ category: "wants_human", route: "draft", confidence: 0.99 }) });
    const r = await runPipeline(msg("I want to talk to a real person please"), patient, { llm: client });
    expect(calls.draft).toHaveLength(0);
    expect(r.route).toBe("person");
  });

  it("a declined draft goes to a person", async () => {
    const { client } = fakeLlm({ draft: { text: "", citations: [], declined: "No record shows a refund." } });
    const r = await runPipeline(msg("where is my refund"), patient, { llm: client });
    expect(r.route).toBe("person");
    expect(r.draft?.declined).toBe("No record shows a refund.");
    expect(statuses(r.trail)).toMatchObject({ draft: "flagged", check: "skipped", decide: "pending" });
    expect(r.trail[4].summary).toMatch(/declined/);
  });

  it("a failed fact check blocks the draft, keeps it, and goes to a person", async () => {
    h.check = {
      facts: [{ text: "21 Sep 2026", kind: "date", found: false }],
      banned: [],
      passed: false,
    };
    const { client } = fakeLlm();
    const r = await runPipeline(msg("where is my order"), patient, { llm: client });
    expect(r.route).toBe("person");
    expect(r.draft?.text).toBe(goodDraft.text);
    expect(r.check?.passed).toBe(false);
    expect(statuses(r.trail)).toMatchObject({ draft: "passed", check: "failed", decide: "pending" });
    expect(r.trail[5].summary).toMatch(/blocked/i);
  });

  it("a draft citing a source that does not exist goes to a person", async () => {
    const { client } = fakeLlm({ draft: { text: goodDraft.text.replace("[2]", "[7]"), citations: [] } });
    const r = await runPipeline(msg("where is my order"), patient, { llm: client });
    expect(r.route).toBe("person");
    expect(r.trail[4].status).toBe("flagged");
  });

  it("invalid sorter output goes to a person but stays in live mode", async () => {
    const { client } = fakeLlm({ sort: new LlmError("invalid_output", "bad json", { usage: { inputTokens: 5, outputTokens: 1, costUsd: 0.0001 } }) });
    const r = await runPipeline(msg("where is my order"), patient, { llm: client });
    expect(r.route).toBe("person");
    expect(r.mode).toBe("live");
    expect(r.usage.inputTokens).toBe(5);
    expect(r.trail[2].status).toBe("flagged");
  });

  it("an unavailable AI falls back to deterministic_only and a person", async () => {
    const { client } = fakeLlm({ sort: new LlmError("unavailable", "network down") });
    const r = await runPipeline(msg("where is my order"), patient, { llm: client });
    expect(r.route).toBe("person");
    expect(r.mode).toBe("deterministic_only");
    expect(r.trail[2].summary).toMatch(/person will reply/);
  });
});

describe("runPipeline: holds and modes", () => {
  it("stop sending sets a hold but the trail continues", async () => {
    h.hits = [{ ruleId: "hold.stop_sending", category: "stop_sending", phrase: "stop sending", start: 0, end: 0 }];
    const { client, calls } = fakeLlm({ sort: routineSort({ category: "plan_change" }) });
    const r = await runPipeline(msg("Please stop sending my orders for now"), patient, { llm: client });
    expect(r.rules.matched).toBe(false);
    expect(r.holdOrders).toBe(true);
    expect(calls.sort).toHaveLength(1);
    expect(r.trail[1].status).toBe("flagged");
    expect(isStopped(r)).toBe(false);
    expect(r.route).toBe("draft");
  });

  it("deterministic_only never calls the AI and routes to a person", async () => {
    const { client, calls } = fakeLlm();
    const r = await runPipeline(msg("where is my order"), patient, { llm: client, mode: "deterministic_only" });
    expect(calls.sort).toHaveLength(0);
    expect(calls.draft).toHaveLength(0);
    expect(r.route).toBe("person");
    expect(r.mode).toBe("deterministic_only");
    expect(r.trail[2].status).toBe("flagged");
    expect(r.trail[2].summary).toMatch(/person will reply/);
    expect(r.trail.map((s) => s.id)).toEqual([...STEP_ORDER]);
  });

  it("with no client and no key, it behaves like deterministic_only", async () => {
    const r = await runPipeline(msg("where is my order"), patient);
    expect(r.mode).toBe("deterministic_only");
    expect(r.route).toBe("person");
  });

  it("still applies the safety rules in deterministic_only mode", async () => {
    h.hits = [{ ruleId: "crisis.x", category: "crisis", phrase: "end it all", start: 0, end: 0 }];
    const r = await runPipeline(msg("I want to end it all"), patient, { mode: "deterministic_only" });
    expect(r.route).toBe("urgent");
    expect(r.holdOrders).toBe(true);
  });
});

describe("runPipeline: onStep", () => {
  it("reports every step once, in order, on the full path", async () => {
    const seen: string[] = [];
    const { client } = fakeLlm();
    const r = await runPipeline(msg("where is my order"), patient, { llm: client, onStep: (s) => seen.push(s.id) });
    expect(seen).toEqual([...STEP_ORDER]);
    expect(r.trail.every((s) => s.title && s.summary)).toBe(true);
  });

  it("reports every step once, in order, after a stop", async () => {
    h.hits = [{ ruleId: "adverse.x", category: "adverse_event", phrase: "seizure", start: 0, end: 0 }];
    const seen: TrailStep[] = [];
    await runPipeline(msg("I had a seizure"), patient, { llm: fakeLlm().client, onStep: (s) => seen.push(s) });
    expect(seen.map((s) => s.id)).toEqual([...STEP_ORDER]);
    expect(seen.slice(2, 6).every((s) => s.status === "skipped")).toBe(true);
  });

  it("no trail text uses em or en dashes", async () => {
    const r = await runPipeline(msg("where is my order"), patient, { llm: fakeLlm().client });
    expect(r.trail.map((s) => s.title + s.summary).join(" ")).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("runPipeline: demo-mode fallback", () => {
  const unavailable = () => new LlmError("unavailable", "network down");

  it("with no key, fallbackLlm keeps the trail going to a checked draft, labelled demo mode", async () => {
    const fb = fakeLlm({ model: "mock" });
    const r = await runPipeline(msg("where is my order"), patient, { fallbackLlm: fb.client });
    expect(fb.calls.sort).toHaveLength(1);
    expect(fb.calls.draft).toHaveLength(1);
    expect(r.route).toBe("draft");
    expect(r.check?.passed).toBe(true);
    expect(r.mode).toBe("deterministic_only");
    expect(r.models).toEqual({ sort: "mock", draft: "mock" });
    expect(isDemoMode(r)).toBe(true);
    expect(r.trail[2].summary.endsWith(SAMPLE_RUN_NOTE)).toBe(true);
    expect(r.trail[4].summary.endsWith(SAMPLE_RUN_NOTE)).toBe(true);
  });

  it("an unavailable sorter falls back to fallbackLlm, which also drafts", async () => {
    const primary = fakeLlm({ sort: unavailable() });
    const fb = fakeLlm({ model: "mock" });
    const r = await runPipeline(msg("where is my order"), patient, { llm: primary.client, fallbackLlm: fb.client });
    expect(primary.calls.sort).toHaveLength(1);
    expect(primary.calls.draft).toHaveLength(0);
    expect(fb.calls.draft).toHaveLength(1);
    expect(r.route).toBe("draft");
    expect(r.mode).toBe("deterministic_only");
  });

  it("invalid sorter output does not use the fallback: a person replies, still live", async () => {
    const primary = fakeLlm({ sort: new LlmError("invalid_output", "bad json") });
    const fb = fakeLlm({ model: "mock" });
    const r = await runPipeline(msg("where is my order"), patient, { llm: primary.client, fallbackLlm: fb.client });
    expect(fb.calls.sort).toHaveLength(0);
    expect(r.route).toBe("person");
    expect(r.mode).toBe("live");
  });

  it("an unavailable drafter falls back to the sample drafter", async () => {
    const primary = fakeLlm({ draft: unavailable() });
    const fb = fakeLlm({ model: "mock" });
    const r = await runPipeline(msg("where is my order"), patient, { llm: primary.client, fallbackLlm: fb.client });
    expect(fb.calls.sort).toHaveLength(0);
    expect(fb.calls.draft).toHaveLength(1);
    expect(r.route).toBe("draft");
    expect(r.models).toEqual({ sort: "fake-sort", draft: "mock" });
    expect(r.mode).toBe("deterministic_only");
  });

  it("an unavailable drafter without a fallback goes to a person and sets deterministic_only", async () => {
    const primary = fakeLlm({ draft: unavailable() });
    const r = await runPipeline(msg("where is my order"), patient, { llm: primary.client });
    expect(r.route).toBe("person");
    expect(r.mode).toBe("deterministic_only");
    expect(r.trail[4].summary).toMatch(/unavailable/);
  });

  it("deterministic_only with a fallback uses only the fallback", async () => {
    const primary = fakeLlm();
    const fb = fakeLlm({ model: "mock" });
    const r = await runPipeline(msg("where is my order"), patient, {
      llm: primary.client,
      fallbackLlm: fb.client,
      mode: "deterministic_only",
    });
    expect(primary.calls.sort).toHaveLength(0);
    expect(fb.calls.sort).toHaveLength(1);
    expect(r.route).toBe("draft");
  });

  it("a mock client's result is never labelled live", async () => {
    const r = await runPipeline(msg("where is my order"), patient, { llm: fakeLlm({ model: "mock" }).client, mode: "live" });
    expect(r.mode).toBe("deterministic_only");
  });

  it("the safety rules still stop before the fallback is called", async () => {
    h.hits = [{ ruleId: "crisis.x", category: "crisis", phrase: "end it all", start: 0, end: 0 }];
    const fb = fakeLlm({ model: "mock" });
    const r = await runPipeline(msg("I want to end it all"), patient, { fallbackLlm: fb.client });
    expect(fb.calls.sort).toHaveLength(0);
    expect(r.route).toBe("urgent");
  });
});

describe("runPipeline: context after a safety stop", () => {
  const P10: SourceRef = { id: "P10.1", kind: "policy", label: "Policy P10.1: Clinical questions", text: "A clinician replies." };

  it("keeps the open orders a hold affects, and only the clinical policy", async () => {
    h.hits = [{ ruleId: "adverse.hospital", category: "adverse_event", phrase: "in hospital", start: 0, end: 0 }];
    h.policy = [POLICY, P10];
    const r = await runPipeline(msg("I was in hospital last night"), patient, { llm: fakeLlm().client });
    expect(r.sources?.records.map((s) => s.id)).toEqual(["ORD-20481"]);
    // Attached by id, not by search: the Australian urgent protocol, then the clinical protocol.
    expect(r.sources?.policy.map((s) => s.id)).toEqual(["P10.2", "P10.1"]);
    const step = r.trail.find((s) => s.id === "sources");
    expect(step?.status).toBe("skipped");
    expect(step?.summary).toMatch(/1 open order affected by the hold/);
  });

  it("does the same when the sorter stops the trail", async () => {
    const { client } = fakeLlm({ sort: routineSort({ category: "side_effect", risk: "clinical", route: "clinician" }) });
    const r = await runPipeline(msg("feeling a bit off lately"), patient, { llm: client });
    expect(r.sources?.records).toHaveLength(1);
    expect(r.trail.find((s) => s.id === "sources")?.summary).toMatch(/kept for the clinician/);
  });
});

describe("runPipeline: stop headline", () => {
  const at = (text: string, phrase: string) => text.indexOf(phrase);

  it("names the medicine rather than the generic phrase", async () => {
    const text = "Is it ok to take my oil with the sertraline my GP put me on?";
    h.hits = [
      { ruleId: "clinical.mix_with", category: "clinical_question", phrase: "Is it ok to", start: 0, end: 11 },
      { ruleId: "clinical.named_medicine", category: "clinical_question", phrase: "sertraline", start: at(text, "sertraline"), end: 0 },
    ];
    const r = await runPipeline(msg(text), patient, { llm: fakeLlm().client });
    expect(r.trail[1].summary).toMatch(/^Clinical question: "sertraline"\./);
  });

  it("an interaction question with 'blood pressure' reads as a clinical question, not a side effect", async () => {
    const text = "My GP started me on blood pressure tablets today. Is it OK to keep taking my capsules alongside them?";
    h.hits = [
      { ruleId: "side_effect.heart", category: "side_effect", phrase: "blood pressure", start: at(text, "blood"), end: 0 },
      { ruleId: "clinical.mix_with", category: "clinical_question", phrase: "Is it OK to", start: at(text, "Is it"), end: 0 },
      { ruleId: "clinical.mix_with", category: "clinical_question", phrase: "taking my capsules alongside", start: at(text, "taking"), end: 0 },
    ];
    const r = await runPipeline(msg(text), patient, { llm: fakeLlm().client });
    expect(headlineCategory(h.hits)).toBe("clinical_question");
    expect(resultCategory(r)).toBe("clinical_question");
    expect(r.trail[1].summary).toMatch(/^Clinical question: "taking my capsules alongside"/);
  });

  it("a real symptom still reads as a side effect, and urgent categories keep their severity order", () => {
    const dizzy: RuleHit = { ruleId: "side_effect.dizzy", category: "side_effect", phrase: "dizzy", start: 5, end: 10 };
    const dose: RuleHit = { ruleId: "clinical.dose", category: "clinical_question", phrase: "dose", start: 20, end: 24 };
    expect(headlineCategory([dizzy, dose])).toBe("side_effect");
    const idiom: RuleHit = { ruleId: "crisis.idiom_kill_me", category: "crisis", phrase: "killing me", start: 0, end: 10 };
    const med: RuleHit = { ruleId: "clinical.named_medicine", category: "clinical_question", phrase: "sertraline", start: 30, end: 40 };
    expect(headlineCategory([idiom, med])).toBe("crisis");
    expect(headlineHit([idiom, med])?.phrase).toBe("killing me");
  });
});

describe("runPipeline: messages not in English", () => {
  it("medicine-like words go straight to a clinician; the sorter only checks it for anything more urgent", async () => {
    const { client, calls } = fakeLlm();
    const r = await runPipeline(msg("Puedo tomar el aceite con mi medicación para la presión?"), patient, { llm: client });
    // One escalation-only sort (it found nothing urgent), and never a draft.
    expect(calls.sort).toHaveLength(1);
    expect(calls.draft).toHaveLength(0);
    expect(r.sort).toBeUndefined();
    expect(r.route).toBe("clinician");
    expect(r.holdOrders).toBe(true);
    expect(r.trail[1].status).toBe("stopped");
    expect(r.trail[1].summary).toMatch(/Not in English/);
  });

  it("anything else is sorted but never drafted, and never sits at routine priority", async () => {
    const { client, calls } = fakeLlm({ sort: routineSort({ confidence: 0.99 }) });
    const r = await runPipeline(msg("Wo ist meine Bestellung? Ich warte seit einer Woche darauf."), patient, { llm: client });
    expect(calls.sort).toHaveLength(1);
    expect(calls.draft).toHaveLength(0);
    expect(r.route).toBe("clinician");
    expect(r.holdOrders).toBe(true);
    expect(r.trail[1].status).toBe("flagged");
    expect(r.trail[2].status).toBe("stopped");
    expect(r.trail[2].summary).toMatch(/not in English/);
  });

  it("with no AI at all, a message not in English still goes to a clinician with a hold", async () => {
    const r = await runPipeline(msg("Wo ist meine Bestellung? Ich warte seit einer Woche darauf."), patient, { mode: "deterministic_only" });
    expect(r.route).toBe("clinician");
    expect(r.holdOrders).toBe(true);
  });

  it("crisis, death and overdose words in other languages are urgent, before any AI", async () => {
    const { client, calls } = fakeLlm();
    for (const text of [
      "Tengo ganas de morir, no puedo más",
      "Hola, dónde está mi pedido? Mi madre falleció el lunes",
      "Ich habe zu viel genommen und mir ist sehr schwindelig, bitte helfen",
      "Aiuto, mio figlio di 4 anni ha bevuto un po' del mio olio dalla bottiglia. Cosa devo fare?",
      "Przepraszam, mój angielski nie jest dobry. Nie chcę już żyć. Nie wiem, co robić.",
    ]) {
      const r = await runPipeline(msg(text), patient, { llm: client });
      expect(r.route, text).toBe("urgent");
      expect(r.holdOrders, text).toBe(true);
    }
    expect(calls.sort).toHaveLength(0);
  });

  it("does not flag English with te reo Maori or Welsh greetings", () => {
    expect(looksNonEnglish("Kia ora, where is my order? Nga mihi")).toBe(false);
    expect(looksNonEnglish("Diolch for sorting my order so quickly, it arrived today")).toBe(false);
    expect(looksNonEnglish("ok ta")).toBe(false);
  });
});

describe("runPipeline: the drafter sees the conversation", () => {
  it("passes the redacted thread to the drafter, as context after the sources", async () => {
    const { client, calls } = fakeLlm({ sort: routineSort({ category: "billing" }) });
    await runPipeline(
      msg("will I be charged for the replacement?", {
        thread: [
          { from: "patient", at: "2026-09-18T19:20:00+10:00", body: "My oil arrived damaged. Maeve Thornbury" },
          { from: "agent", at: "2026-09-21T14:30:00+10:00", body: "Hi Maeve, a replacement is approved. Marco" },
        ],
      }),
      patient,
      { llm: client },
    );
    const input = calls.draft[0];
    expect(input.thread).toHaveLength(2);
    expect(JSON.stringify(input.thread)).not.toMatch(/Maeve|Thornbury/);
    const prompt = buildDraftUserPrompt(input);
    expect(prompt.indexOf("<earlier_messages>")).toBeGreaterThan(prompt.indexOf("</sources>"));
    expect(prompt).toMatch(/context only/);
  });
});

describe("step titles", () => {
  it("match the UI's labels", () => {
    // One vocabulary: the pipeline writes exactly the labels the UI shows, whatever wording lib/format.ts settles on.
    expect(STEP_TITLES).toEqual(STEP_LABEL);
  });
});

describe("mock client (demo-mode sample sorter and drafter)", () => {
  const mock = createMockClient();
  const sortOf = async (text: string) => (await mock.sort({ text, channel: "email", country: "AU" })).sort;

  it("sends requests for a call, complaints, privacy requests and referral questions to a person", async () => {
    expect((await sortOf("Can someone please just ring me and sort it out over the phone?")).category).toBe("wants_human");
    expect((await sortOf("would it be possible for someone to give me a call about it instead?")).category).toBe("wants_human");
    expect((await sortOf("I'm still raging about it. It's pure ridiculous and it's not good enough.")).category).toBe("complaint");
    expect((await sortOf("Once it's cancelled, please delete all the personal data you hold on me.")).category).toBe("privacy_request");
    const referral = await sortOf("The consults were easy. Do you have a referral programme or a discount code?");
    expect(referral.category).toBe("other");
    expect(referral.route).toBe("person");
  });

  it("writes a short reply from the sources, quoting only the patient's country", async () => {
    const charge: SourceRef = {
      id: "CHG-30083",
      kind: "charge",
      label: "Charge CHG-30083, 1 Sep, NZD 130.00",
      text: "Charge CHG-30083: Monthly treatment plan, September 2026 (concession); NZD 130.00; status paid; charged 1 September 2026; type plan",
    };
    const prices: SourceRef = {
      id: "P5.4",
      kind: "policy",
      label: "Policy P5.4: Prices, price changes and concessions",
      text:
        "Monthly plan prices. Australia: one product A$148, two products A$214; concession A$118 and A$171. New Zealand, from 1 September 2026: concession prices are NZ$130 and NZ$189.\n\nPrice changes. We give at least 30 days' notice of a price change by email. Agents should tell the patient where to find the notice.",
    };
    const out = await mock.draft({
      text: "Has the price of my concession plan gone up? I don't remember a price change email.",
      category: "price_change",
      channel: "email",
      country: "NZ",
      sources: [charge, prices],
    });
    const text = out.draft.text;
    expect(out.model).toBe("mock");
    expect(text).toMatch(/^Hi \[FIRST_NAME\],/);
    expect(text).toMatch(/NZD 130\.00/);
    expect(text).not.toMatch(/A\$|Australia/);
    expect(text).not.toMatch(/the patient|Agents/);
    expect(text).not.toMatch(/; status paid; charged/);
    expect(text).not.toMatch(/\u2013|\u2014/);
    expect(out.draft.citations.map((c) => c.sourceId)).toEqual(["CHG-30083", "P5.4"]);
  });
});

describe("messageText", () => {
  it("joins subject and body so rule indices line up", () => {
    expect(messageText(msg("body", { subject: "Subj" }))).toBe("Subj\n\nbody");
    expect(messageText(msg("body"))).toBe("body");
  });
});

describe("llm validation", () => {
  it("accepts a well-formed sort and rejects bad ones", () => {
    expect(validateSort(routineSort())).toMatchObject({ category: "order_status" });
    expect(typeof validateSort({ ...routineSort(), category: "nope" })).toBe("string");
    expect(typeof validateSort({ ...routineSort(), confidence: 1.4 })).toBe("string");
    expect(typeof validateSort({ ...routineSort(), reasons: [] })).toBe("string");
    expect(typeof validateSort("x")).toBe("string");
  });

  it("maps draft markers to sources and rejects bad drafts", () => {
    const d = validateDraft({ declined: "", text: goodDraft.text + " ".repeat(1) + "Extra words to make the reply long enough for the floor check here." }, [ORDER, POLICY]);
    expect(typeof d).toBe("object");
    expect((d as Draft).citations.map((c) => c.sourceId)).toEqual(["ORD-20481", "P3.2"]);
    expect(validateDraft({ declined: "Missing refund record.", text: "" }, [])).toEqual({
      text: "",
      citations: [],
      declined: "Missing refund record.",
    });
    expect(typeof validateDraft({ declined: "", text: "Too short [1]." }, [ORDER])).toBe("string");
    expect(typeof extractCitations("see [3]", [ORDER])).toBe("string");
  });

  it("replaces em and en dashes", () => {
    expect(sanitizeDashes("3\u20135 days \u2014 roughly")).toBe("3 to 5 days, roughly");
  });
});

describe("pricing", () => {
  it("prices Haiku 4.5, Opus 5 and Opus 5.5 per million tokens, including snapshot ids", () => {
    expect(costUsd("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(1);
    expect(costUsd("claude-haiku-4-5-20251001", { inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(5);
    expect(costUsd("claude-opus-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(30);
    expect(costUsd("claude-opus-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.5);
    expect(costUsd("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(24);
    expect(costUsd("claude-opus-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(costUsd("mock", { inputTokens: 5000, outputTokens: 5000 })).toBe(0);
  });
});

// ---------- End to end on the demo data (real rules, retrieval and fact check; the sample client as the AI) ----------

const asList = <T,>(v: unknown, key: string): T[] =>
  (Array.isArray(v) ? v : ((v as Record<string, unknown>)[key] as T[])) ?? [];
const MESSAGES = asList<PatientMessage>(messagesData, "messages");
const PATIENTS = asList<Patient>(patientsData, "patients");
const patientOf = (m: PatientMessage) => PATIENTS.find((p) => p.id === m.patientId) as Patient;
const messageById = (id: string) => MESSAGES.find((m) => m.id === id) as PatientMessage;
const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A message's local calendar day as the holds write it: "23 Sep 2026". */
const localDay = (id: string) => {
  const [y, m, d] = messageById(id).receivedAt.slice(0, 10).split("-").map(Number);
  return `${d} ${SHORT_MONTH[m - 1]} ${y}`;
};
const runReal = (id: string) => {
  const m = messageById(id);
  return runPipeline(m, patientOf(m), { llm: createMockClient(), mode: "live" });
};

describe("demo data: holds only count open orders", () => {
  it("a safety stop for a patient whose orders are all delivered reports no open orders to hold", async () => {
    h.real = true;
    const p = PATIENTS.find((x) => x.id === "PT-1042") as Patient;
    expect(p.orders.every((o) => o.status === "delivered" || o.status === "cancelled")).toBe(true);
    const r = await runPipeline(msg("I want to end it all, please cancel everything", { patientId: p.id }), p, { llm: createMockClient() });
    expect(r.route).toBe("urgent");
    expect(r.trail.find((s) => s.id === "sources")?.summary).toBe("No reply to draft. No open orders to hold.");
  });
});

describe("safety protocols are attached by id", () => {
  it("urgent stops carry the country's urgent protocol and P10.1; clinician stops carry P10.1", async () => {
    expect(safetyProtocolIds("crisis", "urgent", "AU")).toEqual(["P10.2", "P10.1"]);
    expect(safetyProtocolIds("bereavement", "urgent", "NZ")).toEqual(["P10.3", "P10.1"]);
    expect(safetyProtocolIds("adverse_event", "urgent", "UK")).toEqual(["P10.4", "P10.1"]);
    expect(safetyProtocolIds("clinical_question", "clinician", "UK")).toEqual(["P10.1"]);
    for (const [country, id] of [["AU", "P10.2"], ["NZ", "P10.3"], ["UK", "P10.4"]] as const) {
      h.hits = [{ ruleId: "bereavement.passed", category: "bereavement", phrase: "passed away", start: 0, end: 0 }];
      h.policy = [POLICY];
      const r = await runPipeline(msg("Mum passed away on Sunday"), { ...patient, country }, { llm: fakeLlm().client });
      expect(r.sources?.policy.map((s) => s.id)).toEqual([id, "P10.1"]);
    }
    h.hits = [{ ruleId: "clinical.dose", category: "clinical_question", phrase: "how much", start: 0, end: 0 }];
    const c = await runPipeline(msg("how much should I take"), patient, { llm: fakeLlm().client });
    expect(c.sources?.policy.map((s) => s.id)).toEqual(["P10.1"]);
  });

  it("MSG-0120 (NZ, bereavement) carries P10.3", async () => {
    h.real = true;
    const r = await runReal("MSG-0120");
    expect(r.route).toBe("urgent");
    expect(r.sources?.policy.map((s) => s.id)).toEqual(["P10.3", "P10.1"]);
  });
});

describe("records the patient names are included", () => {
  it("passes the message and the thread to selectRecords", async () => {
    await runPipeline(
      msg("will I be charged for the replacement?", {
        thread: [{ from: "patient", at: "2026-09-18T19:20:00+10:00", body: "ORD-20481 arrived damaged" }],
      }),
      patient,
      { llm: fakeLlm({ sort: routineSort({ category: "billing" }) }).client },
    );
    expect(h.recordCalls.at(-1)?.text).toMatch(/charged for the replacement[\s\S]*ORD-20481 arrived damaged/);
  });

  it("MSG-0150's sources include ORD-20019, the order it names", async () => {
    h.real = true;
    const r = await runReal("MSG-0150");
    expect(r.sources?.records.map((s) => s.id)).toContain("ORD-20019");
  });
});

describe("patient-level holds", () => {
  const ids = ["MSG-0003", "MSG-0004", "MSG-0005", "MSG-0049", "MSG-0124", "MSG-0156", "MSG-0143", "MSG-0010", "MSG-0083", "MSG-0122"];

  it("withdraws every unsent draft to a patient whose death is reported, and holds the orders", async () => {
    h.real = true;
    const raw = await Promise.all(ids.map(runReal));
    const held = applyPatientHolds(raw, ids.map(messageById));
    const byId = new Map(held.map((r) => [r.messageId, r]));
    for (const id of ["MSG-0003", "MSG-0004", "MSG-0005", "MSG-0049"]) {
      const r = byId.get(id)!;
      expect(r.route, id).toBe("urgent");
      expect(r.draft, id).toBeUndefined();
      expect(r.holdOrders, id).toBe(true);
      expect(isReadyToSend(r), id).toBe(false);
      expect(isWithdrawn(r), id).toBe(true);
      expect(r.trail.map((s) => s.id)).toEqual([...STEP_ORDER]);
    }
    // The date is the report's own local day, read from the data so a re-timed fixture does not break the test.
    expect(byId.get("MSG-0003")!.trail.find((s) => s.id === "draft")?.summary).toMatch(
      new RegExp(
        String.raw`^(Draft|Reply) withdrawn: a message on ${localDay("MSG-0124")} \(MSG-0124\) reports that the patient may have died\. Nothing is sent to the patient`,
      ),
    );
    expect(byId.get("MSG-0004")!.trail.find((s) => s.id === "draft")?.summary).toContain(`${localDay("MSG-0156")} (MSG-0156)`);
    // The death reports themselves are untouched.
    expect(byId.get("MSG-0124")).toBe(raw[ids.indexOf("MSG-0124")]);
  });

  it("moves a ready draft to a person when the patient reported something urgent", async () => {
    h.real = true;
    const raw = await Promise.all(ids.map(runReal));
    const held = applyPatientHolds(raw, ids.map(messageById));
    for (const id of ["MSG-0010", "MSG-0122"]) {
      const r = held.find((x) => x.messageId === id)!;
      expect(r.route, id).not.toBe("draft");
      expect(isReadyToSend(r), id).toBe(false);
      expect(r.holdOrders, id).toBe(true);
    }
    const r122 = held.find((x) => x.messageId === "MSG-0122")!;
    expect(isHeldForPatient(r122)).toBe(true);
    expect(r122.trail.find((s) => s.id === "decide")?.summary).toMatch(/MSG-0083/);
  });

  it("MSG-0172: a living patient grieving her brother and taking more than prescribed is an urgent adverse event", async () => {
    h.real = true;
    const r = await runReal("MSG-0172");
    expect(r.route).toBe("urgent");
    expect(r.holdOrders).toBe(true);
    expect(resultCategory(r)).toBe("adverse_event");
    expect(headlineCategory(r.rules.hits)).toBe("adverse_event");
    expect(isLivingPatientReport(r.rules.hits)).toBe(true);
    expect(reportsPatientDeath(r)).toBe(false);
    expect(falseAlarmKeepsAlert(r)).toBe(false);
    const rules = r.trail.find((s) => s.id === "rules")!;
    expect(rules.status).toBe("stopped");
    expect(rules.summary).toMatch(/^Adverse event: "taking more of my oil than I['’]m meant to"\./);
    expect(rules.summary).toContain("It also mentions a death, but the writer is using their own treatment");
    expect(rules.summary).not.toMatch(/Bereavement/);
    // Her other messages are held for a clinician first, never withdrawn as if she had died.
    const ids = ["MSG-0078", "MSG-0102", "MSG-0103", "MSG-0172"];
    const held = applyPatientHolds(await Promise.all(ids.map(runReal)), ids.map(messageById));
    for (const x of held.filter((y) => y.messageId !== "MSG-0172")) {
      expect(isWithdrawn(x), x.messageId).toBe(false);
      expect(isReadyToSend(x), x.messageId).toBe(false);
      if (isHeldForPatient(x)) expect(x.trail.find((s) => s.id === "decide")?.summary).toMatch(/a serious reaction .*\(MSG-0172\)/);
    }
    expect(held.some(isHeldForPatient)).toBe(true);
  });

  it("an ambiguous death with no sign of the writer's own treatment still withdraws the patient's replies", async () => {
    h.real = true;
    const r = await runReal("MSG-0120");
    expect(resultCategory(r)).toBe("bereavement");
    expect(reportsPatientDeath(r)).toBe(true);
  });

  it("is idempotent and leaves other patients alone", async () => {
    h.real = true;
    const raw = await Promise.all(ids.map(runReal));
    const once = applyPatientHolds(raw, ids.map(messageById));
    expect(applyPatientHolds(once, ids.map(messageById))).toEqual(once);
    const lone = await runPipeline(msg("where is my order"), patient, { llm: fakeLlm().client });
    expect(applyPatientHolds([lone], [msg("where is my order")])[0]).toBe(lone);
  });
});

describe("sample drafter (the fallback a decision-maker may see)", () => {
  const mock = createMockClient();
  /** The sample draft for a demo message, forced to a category, from the same sources the pipeline would give. */
  const draftFor = async (id: string, category: Category) => {
    h.real = true;
    const m = messageById(id);
    const p = patientOf(m);
    const text = (await runPipeline(m, p, { mode: "deterministic_only" })).redactedText;
    const sources = [...selectRecords(p, category, text), ...searchPolicy(text, category, p.country)];
    return (await mock.draft({ text, category, channel: m.channel, country: p.country, sources })).draft.text;
  };

  it("writes plain sentences: no asides, no record separators, no internal payment wording", async () => {
    h.real = true;
    const drafts: string[] = [];
    for (const m of MESSAGES) {
      const r = await runPipeline(m, patientOf(m), { llm: mock, mode: "live" });
      if (r.draft?.text) drafts.push(r.draft.text);
    }
    expect(drafts.length).toBeGreaterThan(20);
    for (const d of drafts) {
      expect(d).not.toMatch(/\(/);
      expect(d).not.toMatch(/;/);
      expect(d).not.toMatch(/retry \d of \d/i);
      expect(d).not.toMatch(/we charged[^.]*did not go through/);
      expect(d).not.toMatch(/\b(?:they|patients) need/i);
      expect(d).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("describes a failed payment as an attempt", async () => {
    const d = await draftFor("MSG-0075", "billing");
    expect(d).toMatch(/we tried to take \$\d+\.\d{2} (AUD|NZD) for your monthly plan, but the payment did not go through/);
  });

  it("never quotes an unrelated policy sentence", async () => {
    expect(await draftFor("MSG-0017", "order_status")).not.toMatch(/wrong passwords/);
    const fee = await draftFor("MSG-0068", "billing");
    expect(fee).not.toMatch(/The charge covers the prescribed products/);
    const late = await draftFor("MSG-0142", "delivery_problem");
    expect(late).not.toMatch(/thicken or look cloudy|does not need to come back/);
    expect(await draftFor("MSG-0005", "billing")).not.toMatch(/kept for a minimum period/);
  });

  it("answers the standard Try messages for each sample patient", async () => {
    h.real = true;
    const personas = PATIENTS.filter((p) => p.demoPersona);
    expect(personas).toHaveLength(3);
    const ask = async (p: Patient, body: string) =>
      runPipeline({ id: "TRY", patientId: p.id, channel: "chat", receivedAt: "2026-09-23T10:00:00+10:00", body }, p, {
        fallbackLlm: mock,
      });
    for (const p of personas) {
      const store = await ask(p, "How should I store my oil?");
      expect(store.route, p.id).toBe("draft");
      expect(store.draft?.text).toMatch(/below 25°C/);
      const twice = await ask(p, "I was charged twice this month, can you refund one?");
      expect(twice.draft?.text, p.id).toMatch(/only charge I can see/);
      const price = await ask(p, "Why did my price go up this month?");
      const charges = [...p.charges].filter((c) => c.kind === "plan").sort((a, b) => b.at.localeCompare(a.at));
      if (charges[0].amount === charges[1].amount) expect(price.draft?.text, p.id).toMatch(/has not changed/);
      else expect(price.draft?.text, p.id).toMatch(/went from/);
      const where = await ask(p, "where is my order");
      expect(where.route, p.id).toBe("draft");
      expect(where.check?.passed, p.id).toBe(true);
    }
  });
});

describe("sample sorter as the second safety layer", () => {
  const mock = createMockClient();
  it("never drafts a reply to crisis, overdose or emergency wording the rules might miss", async () => {
    h.real = true;
    for (const text of [
      "Ive written letters to my kids and sorted my affairs. please cancel everything",
      "can you cancel everything, ive decided im not going to be around after friday",
      "when will my order arrive? i need it before i do something stupid",
      "my order hasn't come, i'm really struggling without it, having thoughts again",
      "refund please, had to go to a&e after the last bottle",
      "can you pause my deliveries please, my wife is in icu",
      "my son took some of my oil when i wasn't looking",
      "where is my order, i'm not doing well",
    ]) {
      const s = (await mock.sort({ text, channel: "chat", country: "AU" })).sort;
      expect(s.route, text).not.toBe("draft");
    }
    // General crisis wording, not a test-set message: the red-team slice stays held out from the sample sorter's words.
    const crisis = (await mock.sort({ text: "honestly i just want to go to sleep and never wake up", channel: "chat", country: "AU" })).sort;
    expect(crisis.route).toBe("urgent");
  });

  it("still sorts plain routine questions for a draft", async () => {
    for (const text of ["How should I store my oil?", "where is my order", "Why did my price go up this month?"]) {
      expect((await mock.sort({ text, channel: "chat", country: "AU" })).sort.route, text).toBe("draft");
    }
  });
});

describe("clinician-level stops are checked once more for anything urgent", () => {
  const reaction: RuleHit = { ruleId: "side_effect.named", category: "side_effect", phrase: "reaction", start: 0, end: 0 };
  const text = "i think im having a bad reaction, my lips are swelling up";

  it("a clinician-level rule hit plus an urgent sort gives urgent with orders on hold, and never a draft", async () => {
    h.hits = [reaction];
    const { client, calls } = fakeLlm({
      sort: routineSort({ category: "adverse_event", risk: "urgent", route: "urgent", confidence: 0.93, holdOrders: false }),
    });
    const r = await runPipeline(msg(text), patient, { llm: client });
    expect(calls.sort).toHaveLength(1);
    expect(calls.sort[0].text).toBe(r.redactedText);
    expect(calls.draft).toHaveLength(0);
    expect(r.route).toBe("urgent");
    expect(r.holdOrders).toBe(true);
    expect(r.sort?.category).toBe("adverse_event");
    expect(resultCategory(r)).toBe("adverse_event");
    expect(statuses(r.trail)).toEqual({
      redact: "passed",
      rules: "stopped",
      sort: "flagged",
      sources: "skipped",
      draft: "skipped",
      check: "skipped",
      decide: "pending",
    });
    expect(r.trail[2].summary).toMatch(/^Raised to urgent/);
    expect(r.trail[6].summary).toMatch(/Urgent/);
    // The urgent protocol for the patient's country is attached, not only the clinical one.
    expect(r.sources?.policy.map((s) => s.id)).toEqual(["P10.2", "P10.1"]);
  });

  it("raises on urgent risk even with a routine label", async () => {
    h.hits = [reaction];
    const { client } = fakeLlm({ sort: routineSort({ category: "other", risk: "urgent", route: "person" }) });
    const r = await runPipeline(msg(text), patient, { llm: client });
    expect(r.route).toBe("urgent");
    expect(r.holdOrders).toBe(true);
    expect(resultCategory(r)).toBe("side_effect");
  });

  it("never lowers the rules route: a routine sort leaves it with a clinician", async () => {
    h.hits = [reaction];
    const { client, calls } = fakeLlm({ sort: routineSort({ confidence: 0.99 }) });
    const r = await runPipeline(msg(text), patient, { llm: client });
    expect(calls.draft).toHaveLength(0);
    expect(r.route).toBe("clinician");
    expect(r.holdOrders).toBe(false);
    expect(r.sort).toBeUndefined();
    expect(r.trail[1].status).toBe("stopped");
    expect(r.trail[2].status).toBe("passed");
    expect(r.trail[2].summary).toMatch(/stays with a clinician/);
  });

  it("keeps the rules route when the sorter fails, unless the backup word check finds something urgent", async () => {
    h.hits = [reaction];
    const down = fakeLlm({ sort: new LlmError("unavailable", "network down") });
    const plain = await runPipeline(msg("I had a mild reaction to the new bottle"), patient, { llm: down.client });
    expect(plain.route).toBe("clinician");
    expect(plain.trail[2].status).toBe("flagged");
    const swollen = await runPipeline(msg(text), patient, { llm: down.client });
    expect(swollen.route).toBe("urgent");
    expect(swollen.holdOrders).toBe(true);
    expect(swollen.rules.hits.some((x) => x.ruleId === "backup.adverse_event")).toBe(true);
  });

  it("MSG-0904 (anaphylaxis wording that the rules only read as a side effect) is urgent with the sample sorter", async () => {
    h.real = true;
    const r = await runReal("MSG-0904");
    expect(r.route).toBe("urgent");
    expect(r.holdOrders).toBe(true);
    expect(resultCategory(r)).toBe("adverse_event");
    // With no AI at all, the backup word check makes the same call.
    const m = messageById("MSG-0904");
    const offline = await runPipeline(m, patientOf(m), { mode: "deterministic_only" });
    expect(offline.route).toBe("urgent");
    expect(offline.holdOrders).toBe(true);
  });

  it("the patient's other ready draft is held once the stop is raised", async () => {
    h.real = true;
    const ids = ["MSG-0904", "MSG-0169"];
    const raw = await Promise.all(ids.map(runReal));
    const held = applyPatientHolds(raw, ids.map(messageById));
    const other = held.find((r) => r.messageId === "MSG-0169") as PipelineResult;
    expect(isReadyToSend(other)).toBe(false);
    expect(other.holdOrders).toBe(true);
  });
});

describe("words in another language are checked on every message", () => {
  it("a crisis or death phrase inside a mostly English message is urgent, before any AI", async () => {
    const { client, calls } = fakeLlm();
    for (const text of [
      "sorry my english, quiero morir, please help me",
      "Hi, mi mamá falleció last week, please cancel her account",
      "Kei te pīrangi au ki te mate",
      "Mae Dad wedi marw, please stop the orders",
    ]) {
      const r = await runPipeline(msg(text), patient, { llm: client });
      expect(r.route, text).toBe("urgent");
      expect(r.holdOrders, text).toBe(true);
      expect(r.trail[1].status, text).toBe("stopped");
    }
    expect(calls.sort).toHaveLength(0);
    expect(calls.draft).toHaveLength(0);
  });

  it("a medicine word in another language inside an English message goes to a clinician", async () => {
    const { client, calls } = fakeLlm();
    const r = await runPipeline(msg("Can I take my oil with my medicación for my back?"), patient, { llm: client });
    expect(r.route).toBe("clinician");
    expect(r.holdOrders).toBe(true);
    expect(calls.draft).toHaveLength(0);
    expect(r.trail[1].summary).toMatch(/Part of it is in another language/);
  });

  it("raises no false alarm on the demo's English messages", async () => {
    const { client } = fakeLlm();
    const flagged: string[] = [];
    for (const m of MESSAGES.filter((x) => !/^MSG-09/.test(x.id))) {
      const r = await runPipeline(m, patientOf(m), { llm: client });
      if (r.rules.hits.some((x) => x.ruleId.startsWith("foreign.")) && !looksNonEnglish(r.redactedText)) flagged.push(m.id);
    }
    expect(flagged).toEqual([]);
  });
});

describe("a clinician or urgent result always carries a safety category", () => {
  it("uses the pipeline's safety category when the sorter escalated with a routine label, so holds apply", async () => {
    const { client } = fakeLlm({ sort: routineSort({ category: "other", risk: "urgent", route: "urgent" }) });
    const urgent = await runPipeline(msg("something odd happened last night", { id: "MSG-0002" }), patient, { llm: client });
    expect(urgent.route).toBe("urgent");
    expect(resultCategory(urgent)).toBe("adverse_event");
    const routine = await runPipeline(msg("where is my order"), patient, { llm: fakeLlm().client });
    expect(isReadyToSend(routine)).toBe(true);
    const held = applyPatientHolds([urgent, routine], [msg("x", { id: "MSG-0002" }), msg("where is my order")]);
    expect(isReadyToSend(held[1])).toBe(false);
    expect(isHeldForPatient(held[1])).toBe(true);
  });

  it("a message not in English that the sorter called routine reads as a clinical question", async () => {
    const { client } = fakeLlm({ sort: routineSort({ category: "other", confidence: 0.5 }) });
    const r = await runPipeline(msg("Wo ist meine Bestellung? Ich warte seit einer Woche darauf."), patient, { llm: client });
    expect(r.route).toBe("clinician");
    expect(resultCategory(r)).toBe("clinical_question");
  });
});

describe("record hints steer the policy search", () => {
  it("MSG-0095 (an order on hold for a failed payment) finds P5.2 Failed payments", async () => {
    h.real = true;
    const m = messageById("MSG-0095");
    const r = await runPipeline(m, patientOf(m), { llm: fakeLlm({ sort: routineSort({ category: "order_status" }) }).client });
    expect(r.sources?.policy.map((s) => s.id)).toContain("P5.2");
  });
});

describe("the backup word check when no sorter answers", () => {
  it("sends urgent wording to a clinician as urgent, and closer-look wording to a person with orders held", async () => {
    const urgent = await runPipeline(msg("i just want to go to sleep and never wake up"), patient, { mode: "deterministic_only" });
    expect(urgent.route).toBe("urgent");
    expect(urgent.holdOrders).toBe(true);
    expect(urgent.trail[2].status).toBe("stopped");
    const concern = await runPipeline(msg("where is my order, I'm really struggling"), patient, { mode: "deterministic_only" });
    expect(concern.route).toBe("person");
    expect(concern.holdOrders).toBe(true);
    expect(concern.trail[2].summary).toMatch(/closer look/);
    const plain = await runPipeline(msg("where is my order"), patient, { mode: "deterministic_only" });
    expect(plain.route).toBe("person");
    expect(plain.holdOrders).toBe(false);
  });

  it("also runs when the AI fails", async () => {
    const { client } = fakeLlm({ sort: new LlmError("invalid_output", "bad json") });
    const r = await runPipeline(msg("my son drank some of my oil"), patient, { llm: client });
    expect(r.route).toBe("urgent");
    expect(r.mode).toBe("live");
  });
});

describe("sample sorter: typical Try messages (the fallback a decision-maker may see)", () => {
  const TRY: [string, Category][] = [
    ["where is my order", "order_status"],
    ["When will my next order ship?", "order_status"],
    ["how long does delivery take to Melbourne?", "order_status"],
    ["Where's my order? It hasn't arrived yet", "delivery_problem"],
    ["I'm moving house, send my next order to my new address", "delivery_problem"],
    ["Can you leave the parcel at the front door?", "delivery_problem"],
    ["Why did my price go up this month?", "price_change"],
    ["I was charged twice this month, can you refund one?", "billing"],
    ["Can I get a receipt for my last payment?", "billing"],
    ["My card expired, how do I update my card details?", "billing"],
    ["I'd like to cancel my subscription", "plan_change"],
    ["Can I pause my plan while I'm overseas?", "plan_change"],
    ["When is my next appointment?", "appointment"],
    ["Is my renewal appointment still on?", "appointment"],
    ["I need to reschedule my appointment", "appointment"],
    ["I'm running low, how do I renew my script?", "script_renewal"],
    ["I can't log in, the password reset link isn't working", "account_access"],
    ["How should I store my oil?", "product_question"],
    ["Does the packaging show what's inside?", "product_question"],
    ["Your service is terrible, my last order took forever", "complaint"],
    ["Can I speak to a real person please?", "wants_human"],
    ["Please delete my personal data", "privacy_request"],
  ];
  const PERSON_TYPES: Category[] = ["complaint", "wants_human", "privacy_request", "other"];
  const tryMessage = (p: Patient, body: string): PatientMessage => ({
    id: "TRY",
    patientId: p.id,
    channel: "chat",
    receivedAt: "2026-09-23T10:00:00+10:00",
    body,
  });

  it("sorts each one to the right type, and drafts a checked reply for every routine type", async () => {
    h.real = true;
    const mock = createMockClient();
    const personas = PATIENTS.filter((p) => p.demoPersona);
    expect(personas).toHaveLength(3);
    for (const p of personas) {
      for (const [body, category] of TRY) {
        const r = await runPipeline(tryMessage(p, body), p, { fallbackLlm: mock });
        const where = `${p.id}: ${body}`;
        expect(r.sort?.category, where).toBe(category);
        if (PERSON_TYPES.includes(category)) {
          expect(r.route, where).toBe("person");
        } else {
          expect(r.route, where).toBe("draft");
          expect(isReadyToSend(r), where).toBe(true);
        }
      }
    }
  });

  it("thanks, rather than apologises, for a new address", async () => {
    h.real = true;
    const p = PATIENTS.find((x) => x.demoPersona) as Patient;
    const r = await runPipeline(tryMessage(p, "I'm moving house, send my next order to my new address"), p, {
      fallbackLlm: createMockClient(),
    });
    expect(r.draft?.text).toMatch(/new address/);
    expect(r.draft?.text).not.toMatch(/sorry/i);
  });

  it("never drafts to someone writing about another person's account or a loss", async () => {
    const mock = createMockClient();
    for (const text of [
      "We lost him on Sunday. Please close his account",
      "I'm writing on behalf of my father, please stop his orders",
      "Can you cancel her account please",
    ]) {
      const s = (await mock.sort({ text, channel: "chat", country: "AU" })).sort;
      expect(s.route, text).not.toBe("draft");
      expect(s.holdOrders, text).toBe(true);
    }
  });

  it("a lost parcel is still a delivery problem, not a loss", async () => {
    const s = (await createMockClient().sort({ text: "I think my parcel was lost in the post", channel: "chat", country: "AU" })).sort;
    expect(s.category).toBe("delivery_problem");
  });
});
