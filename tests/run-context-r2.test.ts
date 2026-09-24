/**
 * Rehearsal round 2 fixes in the pipeline, run on the real modules (rules, redaction, retrieval, fact check) with a
 * scripted AI client, using the demo messages the reviewers flagged:
 *  P5 (a)  the same patient's other recent messages reach the drafter, labelled, and nothing else (MSG-0115 -> MSG-0118)
 *  P5 (b)  an open order past its ETA carries a status line worked out in code (MSG-0066)
 *  P9 (d)  hold notes say what the other message showed (MSG-0120 for MSG-0002, MSG-0160 for MSG-0182)
 *  loose end: the check step never says "All N facts match the sources" when some came from the patient (MSG-0036)
 */
import { describe, expect, it } from "vitest";
import type { Category, Patient, PatientMessage, PipelineResult, Route, SortResult, SourceRef } from "@/lib/types";
import {
  RECENT_MESSAGE_LIMIT,
  applyPatientHolds,
  isHeldForPatient,
  recentMessagesFor,
  reportedWords,
  runPipeline,
  separateMessageLabel,
} from "@/lib/pipeline/run";
import type { DraftInput, LlmClient, SortInput } from "@/lib/pipeline/llm";
import { lateOrderNote, selectRecords } from "@/lib/pipeline/retrieve";
import { checkDraft } from "@/lib/pipeline/check";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";

const MESSAGES: PatientMessage[] = (Array.isArray(messagesData) ? messagesData : (messagesData as { messages: PatientMessage[] }).messages) as PatientMessage[];
const PATIENTS: Patient[] = (Array.isArray(patientsData) ? patientsData : (patientsData as { patients: Patient[] }).patients) as Patient[];
const messageById = (id: string) => MESSAGES.find((m) => m.id === id)!;
const patientOf = (m: PatientMessage) => PATIENTS.find((p) => p.id === m.patientId)!;
/** The desk slice, as the scripts pass it (the red-team slice, MSG-0901 onwards, only sees its own). */
const DESK = MESSAGES.filter((m) => m.id < "MSG-0901");

const ZERO = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** A scripted AI: routine sorts at high confidence (or a given answer), and a draft built from the sources it was given. */
function scripted(
  sortFor: (input: SortInput) => Partial<SortResult> & { category: Category },
  draftFor: (input: DraftInput) => string = (input) => `Thanks for your message. The team will look into it [${input.sources.length}].`,
) {
  const calls = { sort: [] as SortInput[], draft: [] as DraftInput[] };
  const client: LlmClient = {
    async sort(input) {
      calls.sort.push(input);
      const s = sortFor(input);
      const sort: SortResult = { risk: "routine", route: "draft" as Route, confidence: 0.95, reasons: ["scripted"], holdOrders: false, ...s };
      return { sort, usage: ZERO, model: "scripted-sort" };
    },
    async draft(input) {
      calls.draft.push(input);
      return { draft: { text: draftFor(input), citations: [] }, usage: ZERO, model: "scripted-draft" };
    },
  };
  return { client, calls };
}

// ---------- P5 (a): the same patient's other recent messages ----------

describe("recentMessagesFor: the same patient's messages from the 7 days before this one", () => {
  it("MSG-0118 sees MSG-0115 ('Please stop sending anything for now'), not the later MSG-0047", () => {
    const got = recentMessagesFor(messageById("MSG-0118"), DESK).map((m) => m.id);
    expect(got).toContain("MSG-0115");
    expect(got).not.toContain("MSG-0047"); // sent after MSG-0118
    expect(got).not.toContain("MSG-0118");
  });

  it("ignores other patients, later messages and anything older than the window; keeps the newest, oldest first", () => {
    const base: PatientMessage = { id: "MSG-9000", patientId: "PT-X", channel: "email", receivedAt: "2026-09-23T12:00:00+10:00", body: "now" };
    const at = (id: string, iso: string, patientId = "PT-X"): PatientMessage => ({ ...base, id, patientId, receivedAt: iso, body: id });
    const pool = [
      at("MSG-9001", "2026-09-15T11:00:00+10:00"), // 8 days before: outside
      at("MSG-9002", "2026-09-17T12:00:00+10:00"),
      at("MSG-9003", "2026-09-23T11:00:00+10:00"),
      at("MSG-9004", "2026-09-23T13:00:00+10:00"), // after
      at("MSG-9005", "2026-09-22T12:00:00+10:00", "PT-Y"), // someone else
      base,
    ];
    expect(recentMessagesFor(base, pool).map((m) => m.id)).toEqual(["MSG-9002", "MSG-9003"]);
    const many = Array.from({ length: 8 }, (_, i) => at(`MSG-91${i}`, `2026-09-2${i % 3}T0${i}:00:00+10:00`));
    const kept = recentMessagesFor(base, many);
    expect(kept).toHaveLength(RECENT_MESSAGE_LIMIT);
    const times = kept.map((m) => Date.parse(m.receivedAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("labels a separate message by channel and how long before, with no date and no message id", () => {
    const label = separateMessageLabel(messageById("MSG-0115"), messageById("MSG-0118"));
    expect(label).toBe(
      "[A separate message from this patient, not part of this conversation: sent by email 2 minutes before the message you are replying to. It gets its own reply. Use it only to understand this message: answer nothing in it that this message does not ask about, promise no follow-up on it, and state nothing from it as a fact. If this message follows on from it, you may say in a few words what the patient asked there, as their request and not as something done, and answer this message with that in mind.]",
    );
    expect(label).not.toMatch(/MSG-|\d{4}|September|Sep/);
  });
});

describe("runPipeline with recentMessages: the drafter sees the patient's last email (MSG-0118 after MSG-0115)", () => {
  const m = messageById("MSG-0118");
  const p = patientOf(m);
  const billing = () => ({ category: "billing" as Category });

  it("adds MSG-0115 to the drafter's earlier messages as a separate, labelled patient message, redacted", async () => {
    const { client, calls } = scripted(billing);
    const r = await runPipeline(m, p, { llm: client, recentMessages: recentMessagesFor(m, DESK) });
    expect(r.route).toBe("draft");
    const thread = calls.draft[0].thread ?? [];
    const separate = thread.find((t) => t.body.includes("Please stop sending anything for now."));
    expect(separate?.from).toBe("patient");
    expect(separate?.body.startsWith("[A separate message from this patient, not part of this conversation: sent by email 2 minutes before")).toBe(true);
    expect(separate?.body).toContain("Subject: Stop");
    // Redacted like the thread: the patient's own name ("Lucas") never reaches the AI.
    for (const t of thread) expect(t.body).not.toMatch(/\bLucas\b/);
    // Never a mid-conversation reply: only patient messages are added, so the email format stays as it was.
    expect(thread.every((t) => t.from === "patient")).toBe(true);
    // The result says which messages the drafter read, so a person can see the same context.
    expect(r.recentMessageIds).toContain("MSG-0115");
  });

  it("records no recentMessageIds when the rules stop the message before any draft, or with no option", async () => {
    const urgent = messageById("MSG-0047");
    const stopped = await runPipeline(urgent, p, { llm: scripted(billing).client, recentMessages: recentMessagesFor(urgent, DESK) });
    expect(stopped.recentMessageIds).toBeUndefined();
    const plain = await runPipeline(m, p, { llm: scripted(billing).client });
    expect("recentMessageIds" in plain).toBe(false);
  });

  it("changes nothing else: the sorter's input, the route, the hold and the redacted text are the same as without it", async () => {
    const a = scripted(billing);
    const b = scripted(billing);
    const without = await runPipeline(m, p, { llm: a.client });
    const withIt = await runPipeline(m, p, { llm: b.client, recentMessages: recentMessagesFor(m, DESK) });
    expect(b.calls.sort[0]).toEqual(a.calls.sort[0]);
    expect(withIt.route).toBe(without.route);
    expect(withIt.holdOrders).toBe(without.holdOrders);
    expect(withIt.redactedText).toBe(without.redactedText);
    expect(withIt.rules).toEqual(without.rules);
    expect(withIt.sources).toEqual(without.sources);
    // Without the option the drafter's earlier messages are exactly the conversation's own (none here).
    expect(a.calls.draft[0].thread ?? []).toEqual([]);
  });

  it("ignores messages from another patient, this message itself, and later ones", async () => {
    const { client, calls } = scripted(billing);
    const later = messageById("MSG-0047"); // same patient, 33 minutes later
    const other = MESSAGES.find((x) => x.patientId !== m.patientId)!;
    await runPipeline(m, p, { llm: client, recentMessages: [m, later, other] });
    expect(calls.draft[0].thread ?? []).toEqual([]);
  });

  it("a name written only in a separate message is hidden in the drafter's copy of it", async () => {
    const { client, calls } = scripted(billing);
    const earlier: PatientMessage = { ...messageById("MSG-0115"), id: "MSG-8001", body: "Please stop sending anything for now. Thanks, Karen" };
    await runPipeline(m, p, { llm: client, recentMessages: [earlier] });
    const thread = calls.draft[0].thread ?? [];
    expect(thread).toHaveLength(1);
    expect(thread[0].body).not.toContain("Karen");
  });

  it("a separate message never unlocks a safety stop: an urgent message still stops before any draft", async () => {
    const urgent = messageById("MSG-0047"); // "took way too much by accident ... ended up in ED"
    const { client, calls } = scripted(billing);
    const r = await runPipeline(urgent, p, { llm: client, recentMessages: recentMessagesFor(urgent, DESK) });
    expect(r.route).toBe("urgent");
    expect(r.holdOrders).toBe(true);
    expect(calls.draft).toHaveLength(0);
  });
});

// ---------- P5 (b): past-ETA status line ----------

describe("lateOrderNote: an open order past its ETA says so, worked out in code (MSG-0066)", () => {
  const m = messageById("MSG-0066"); // received 23 Sep 2026
  const p = patientOf(m);
  const order = p.orders!.find((o) => o.id === "ORD-20103")!; // shipped, ETA 22 September 2026

  it("ORD-20103 was due 22 September; on 23 September it is 1 business day past", () => {
    // Final round (e): written the way a draft says it, so the fact is word for word in the cited order.
    expect(lateOrderNote(order, m.receivedAt)).toBe(
      "1 business day past its estimated delivery date as of this message (weekends not counted)",
    );
  });

  it("says nothing on the ETA day or before, without a date, or for an order that is not shipped", () => {
    expect(lateOrderNote(order, "2026-09-22T23:30:00+01:00")).toBeUndefined();
    expect(lateOrderNote(order, "2026-09-20T09:00:00+01:00")).toBeUndefined();
    expect(lateOrderNote(order, undefined)).toBeUndefined();
    expect(lateOrderNote({ ...order, status: "delivered" }, m.receivedAt)).toBeUndefined();
    expect(lateOrderNote({ ...order, status: "cancelled" }, m.receivedAt)).toBeUndefined();
    // Not with the courier yet: an order on hold or with the pharmacy is not a late parcel to trace (P4.2).
    for (const status of ["on_hold", "dispensing", "script_pending"] as const) {
      expect(lateOrderNote({ ...order, status }, m.receivedAt), status).toBeUndefined();
    }
    expect(lateOrderNote({ ...order, eta: undefined }, m.receivedAt)).toBeUndefined();
  });

  it("counts business days only: a Friday ETA is 0 on Sunday and 1 on Monday; 2 on the Tuesday", () => {
    const fri = { ...order, eta: "2026-09-25" };
    expect(lateOrderNote(fri, "2026-09-27T10:00:00+01:00")).toMatch(/^0 business days past its estimated delivery date /);
    expect(lateOrderNote(fri, "2026-09-28T10:00:00+01:00")).toMatch(/^1 business day past its estimated delivery date /);
    expect(lateOrderNote(fri, "2026-09-29T10:00:00+01:00")).toMatch(/^2 business days past its estimated delivery date /);
  });

  it("selectRecords adds the line only when given the message's date", () => {
    const withDate = selectRecords(p, "order_status", m.body, { asOf: m.receivedAt }).find((r) => r.id === "ORD-20103")!;
    const plain = selectRecords(p, "order_status", m.body).find((r) => r.id === "ORD-20103")!;
    expect(withDate.text).toBe(`${plain.text}; ${lateOrderNote(order, m.receivedAt)}`);
    expect(plain.text).not.toContain("past its estimated delivery date");
    // The delivered August order never gets it.
    const delivered = selectRecords(p, "order_status", "ORD-20102", { asOf: m.receivedAt }).find((r) => r.id === "ORD-20102")!;
    expect(delivered.text).not.toContain("past its estimated");
  });

  it("the line gives the fact check only the lateness itself: no promise, no date", () => {
    const withDate = selectRecords(p, "order_status", m.body, { asOf: m.receivedAt }).find((r) => r.id === "ORD-20103")!;
    const sources: SourceRef[] = [withDate];
    // A promise the records do not make still fails, exactly as before the line was added.
    expect(checkDraft("Your parcel should arrive in 1 business day [1].", sources).passed).toBe(false);
    expect(checkDraft("It should be with you within 1 business day [1].", sources).passed).toBe(false);
    expect(checkDraft("Courierline will deliver it 1 business day from now [1].", sources).passed).toBe(false);
    expect(checkDraft("It will arrive on 23 September [1].", sources).passed).toBe(false);
    expect(checkDraft("It is on its way with Courierline, tracking CD9599249567 [1].", sources).passed).toBe(true);
    // The lateness the line states is found in the order itself (final round (e), MSG-0066); a wrong count is not.
    const r = checkDraft("The estimated delivery date was 22 September 2026, and the order is now 1 business day past that date [1].", sources);
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "1 business day")).toMatchObject({ found: true, sourceId: "ORD-20103" });
    expect(checkDraft("The order is now 2 business days past its estimated delivery date [1].", sources).passed).toBe(false);
  });

  it("runPipeline passes it to the drafter with recordsAsOf, and not without", async () => {
    const a = scripted(() => ({ category: "order_status" }));
    await runPipeline(m, p, { llm: a.client, recordsAsOf: m.receivedAt });
    expect(a.calls.draft[0].sources.find((s) => s.id === "ORD-20103")?.text).toContain("past its estimated delivery date as of this message");
    const b = scripted(() => ({ category: "order_status" }));
    await runPipeline(m, p, { llm: b.client });
    expect(b.calls.draft[0].sources.find((s) => s.id === "ORD-20103")?.text).not.toContain("past its estimated");
  });
});

// ---------- Check step wording when facts came from the patient ----------

describe("the check step trail line with 'check first' facts (round-2 loose end, MSG-0036)", () => {
  const m = messageById("MSG-0036"); // asks to move the 18 November consult to Wednesday 11 November
  const p = patientOf(m);

  it("says how many facts are the patient's own, never 'All N facts match the sources'", async () => {
    const { client } = scripted(
      () => ({ category: "appointment" }),
      (input) => {
        const n = input.sources.findIndex((s) => s.id === "APT-40003") + 1;
        return `Your follow-up consult is currently booked for 18 November 2026 at 9:00 am [${n}]. The team will look into moving it to 11 November and will confirm the new time with you.`;
      },
    );
    const r = await runPipeline(m, p, { llm: client });
    expect(r.check?.passed).toBe(true);
    expect(r.check?.checkFirst).toBe(1);
    const step = r.trail.find((s) => s.id === "check")!;
    expect(step.status).toBe("passed");
    expect(step.summary).toBe("3 facts checked: 2 found in the sources, 1 from the patient's own message (check first)");
    expect(step.summary).not.toMatch(/^All \d+ facts match/);
  });

  it("keeps the old wording when every fact is in the sources", async () => {
    const { client } = scripted(
      () => ({ category: "appointment" }),
      (input) => `Your follow-up consult is booked for 18 November 2026 at 9:00 am [${input.sources.findIndex((s) => s.id === "APT-40003") + 1}].`,
    );
    const r = await runPipeline(m, p, { llm: client });
    expect(r.check?.checkFirst).toBeUndefined();
    expect(r.trail.find((s) => s.id === "check")?.summary).toBe("All 2 facts match the sources");
  });
});

// ---------- P9 (d): hold-note wording ----------

describe("hold notes say what the other message showed (P9 d)", () => {
  const run = async (id: string, sortFor: (input: SortInput) => Partial<SortResult> & { category: Category }): Promise<PipelineResult> => {
    const m = messageById(id);
    return runPipeline(m, patientOf(m), { llm: scripted(sortFor).client });
  };
  const decide = (r: PipelineResult) => r.trail.find((s) => s.id === "decide")!.summary;

  it("MSG-0120 (a relative's death, signed by the patient) holds MSG-0002 with 'told us someone close to them died'", async () => {
    const r120 = await run("MSG-0120", () => ({ category: "delivery_problem" }));
    expect(r120.route).toBe("urgent");
    expect(r120.rules.hits.some((h) => h.ruleId === "bereavement.relative_of_patient")).toBe(true);
    const r002 = await run("MSG-0002", () => ({ category: "price_change" }));
    expect(r002.route).toBe("draft");
    const held = applyPatientHolds([r002, r120], [messageById("MSG-0002"), messageById("MSG-0120")]);
    const h002 = held.find((x) => x.messageId === "MSG-0002")!;
    // The hold itself is unchanged: a person, orders held, not ready to send.
    expect(isHeldForPatient(h002)).toBe(true);
    expect(h002.route).toBe("person");
    expect(h002.holdOrders).toBe(true);
    expect(decide(h002)).toBe(
      "Held for a person: this patient told us someone close to them died on 23 Sep 2026 (MSG-0120). Check with the clinician before anything is sent. Orders are on hold.",
    );
    expect(decide(h002)).not.toContain("reported a death");
  });

  it("MSG-0160 (a double dose the sorter raised to urgent, no symptom named) holds MSG-0182 with 'reported something urgent'", async () => {
    const r160 = await run("MSG-0160", () => ({ category: "adverse_event", risk: "urgent", route: "urgent", holdOrders: true }));
    expect(r160.route).toBe("urgent");
    expect(r160.rules.hits.every((h) => h.category !== "adverse_event")).toBe(true);
    const r182 = await run("MSG-0182", () => ({ category: "script_renewal" }));
    const held = applyPatientHolds([r182, r160], [messageById("MSG-0182"), messageById("MSG-0160")]);
    const h182 = held.find((x) => x.messageId === "MSG-0182")!;
    expect(isHeldForPatient(h182)).toBe(true);
    expect(h182.holdOrders).toBe(true);
    expect(decide(h182)).toMatch(/^Held for a person: this patient reported something urgent on 23 Sep 2026 \(MSG-0160\)\./);
    expect(decide(h182)).not.toContain("serious reaction");
  });

  it("reportedWords keeps the specific words when a rule hit supports them", () => {
    const base = { route: "urgent" as Route, rules: { matched: true, hits: [] as PipelineResult["rules"]["hits"] } };
    const ae = { ...base, rules: { matched: true, hits: [{ ruleId: "adverse.more_than", category: "adverse_event" as const, phrase: "more than", start: 0, end: 9 }] } };
    expect(reportedWords(ae as PipelineResult, "adverse_event")).toBe("reported a serious reaction");
    const death = { ...base, rules: { matched: true, hits: [{ ruleId: "bereavement.passed_away", category: "bereavement" as const, phrase: "passed away", start: 0, end: 11 }] } };
    expect(reportedWords(death as PipelineResult, "bereavement")).toBe("reported a death");
    // An earlier message's relative death counts too (thread. prefix).
    const thread = { ...base, rules: { matched: true, hits: [{ ruleId: "thread.bereavement.relative_of_patient", category: "bereavement" as const, phrase: "my dad passed away", start: -1, end: -1 }] } };
    expect(reportedWords(thread as PipelineResult, "bereavement")).toBe("told us someone close to them died");
    // Crisis keeps its own words, whoever raised it.
    expect(reportedWords(base as PipelineResult, "crisis")).toBe("reported something urgent about their safety");
    // A clinician-level hold with no rule hit keeps the category's words.
    expect(reportedWords({ ...base, route: "clinician" } as PipelineResult, "clinical_question")).toBe("reported a clinical question");
  });
});
