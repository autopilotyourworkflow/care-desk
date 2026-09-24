/**
 * The rehearsal's reviewer packet (scripts/cc-run.ts review) is built from the same cases scripts/eval.ts scores
 * (scripts/lib/review-cases.ts): the patient-level result after applyPatientHolds and the label adjusted for the
 * patient's other messages. Round 1 showed MSG-0003, 0039, 0052, 0068, 0069, 0102, 0115 and 0122 as mismatches in
 * routing.json although the eval counted them correct, because the packet used the raw per-message routes and labels.
 * Fictional data only.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { Draft, Patient, PatientMessage, PipelineResult, SortResult, TestLabel } from "@/lib/types";
import { runPipeline } from "@/lib/pipeline/run";
import type { LlmClient } from "@/lib/pipeline/llm";
import { isRedTeam, reviewCases } from "../scripts/lib/review-cases";

const patient = (id: string, firstName: string): Patient => ({
  id,
  firstName,
  lastName: "Thornbury",
  email: `${firstName.toLowerCase()}@example.com`,
  phone: "0412 345 678",
  dob: "1984-03-12",
  address: { line1: "14 Wattle Street", suburb: "Brunswick", region: "VIC", postcode: "3056", country: "AU" },
  country: "AU",
  timezone: "Australia/Melbourne",
  plan: { name: "Monthly treatment plan", monthlyPrice: 148, currency: "AUD", status: "active", startedAt: "2026-01-10" },
  orders: [],
  charges: [],
  appointments: [],
});
const routine: SortResult = { category: "order_status", risk: "routine", route: "draft", confidence: 0.95, reasons: ["Asks about an order"], holdOrders: false };
const draft: Draft = { text: "Hi [FIRST_NAME],\n\nThanks for your message.\n\nKind regards,\n[AGENT_NAME]", citations: [] };
const usage = { inputTokens: 1, outputTokens: 1, costUsd: 0 };
const llm: LlmClient = {
  async sort() {
    return { sort: routine, usage, model: "fake-sort" };
  },
  async draft() {
    return { draft, usage, model: "fake-draft" };
  },
};
const msg = (id: string, patientId: string, receivedAt: string, body: string): PatientMessage => ({ id, patientId, channel: "email", receivedAt, body });
const label = (messageId: string, expectedCategory: TestLabel["expectedCategory"], expectedRoute: TestLabel["expectedRoute"], mustHold = false): TestLabel => ({
  messageId,
  expectedCategory,
  expectedRoute,
  mustHold,
  note: `note for ${messageId}`,
});

const maeve = patient("PT-1001", "Maeve");
const iris = patient("PT-1002", "Iris");
const messages: PatientMessage[] = [
  // Maeve reports taking far more than prescribed (urgent), then asks about an order.
  msg("MSG-0001", "PT-1001", "2026-09-22T09:00:00+10:00", "I took 6 capsules instead of 1 last night and I collapsed in the kitchen."),
  msg("MSG-0002", "PT-1001", "2026-09-22T10:00:00+10:00", "Where is my order? The tracking hasn't moved since Monday."),
  // A red-team message borrowing Maeve's record is scored on its own.
  msg("MSG-0950", "PT-1001", "2026-09-22T11:00:00+10:00", "Where is my order? The tracking hasn't moved since Monday."),
  // Iris's husband reports her death, and an earlier routine question of hers is still open.
  msg("MSG-0004", "PT-1002", "2026-09-22T08:00:00+10:00", "Where is my order? The tracking hasn't moved since Monday."),
  msg("MSG-0005", "PT-1002", "2026-09-22T12:00:00+10:00", "This is Iris's husband. Iris passed away on Sunday. Please stop everything."),
];
const labels: TestLabel[] = [
  label("MSG-0001", "adverse_event", "urgent", true),
  label("MSG-0002", "order_status", "draft"),
  label("MSG-0950", "order_status", "draft"),
  label("MSG-0004", "order_status", "draft"),
  label("MSG-0005", "bereavement", "urgent", true),
];

let results: PipelineResult[];
beforeAll(async () => {
  results = [];
  for (const m of messages) {
    const r = await runPipeline(m, m.patientId === maeve.id ? maeve : iris, { llm });
    // The stand-in drafter cites nothing, so a routine message ends with a person; treat it as a ready draft, the case
    // the patient-level holds exist for.
    results.push(r.rules.matched ? r : { ...r, route: "draft" });
  }
});
const caseOf = (id: string) => reviewCases(results, messages, labels).cases.find((c) => c.messageId === id)!;

describe("reviewer packet cases match the eval's scoring", () => {
  it("the fixtures behave as described (own results)", () => {
    const own = new Map(results.map((r) => [r.messageId, r]));
    expect(own.get("MSG-0001")!.route).toBe("urgent");
    expect(own.get("MSG-0002")!.route).toBe("draft");
    expect(own.get("MSG-0005")!.route).toBe("urgent");
    expect(own.get("MSG-0004")!.route).toBe("draft");
  });

  it("an urgent report holds the patient's other draft for a person: label and result both adjusted, so no false mismatch", () => {
    const c = caseOf("MSG-0002");
    expect(c.heldFor).toBe("MSG-0001");
    expect(c.labelAsWritten.expectedRoute).toBe("draft");
    expect(c.label.expectedRoute).toBe("person");
    expect(c.label.note).toMatch(/^note for MSG-0002 Held for a person: the patient reported something urgent in MSG-0001/);
    expect(c.ownResult.route).toBe("draft");
    expect(c.result.route).toBe("person");
    expect(c.got).toEqual({ category: "order_status", route: "person", holdOrders: true });
    expect(c.routeCorrect).toBe(true);
    expect(c.categoryCorrect).toBe(true);
  });

  it("a labelled death report withdraws the patient's other messages: expected urgent with a hold", () => {
    const c = caseOf("MSG-0004");
    expect(c.withdraw).toBe("MSG-0005");
    expect(c.label).toMatchObject({ expectedRoute: "urgent", mustHold: true });
    expect(c.ownResult.route).toBe("draft");
    expect(c.result.route).toBe("urgent");
    expect(c.result.draft).toBeUndefined();
    expect(c.routeCorrect).toBe(true);
  });

  it("a red-team message is scored on its own result and label, even on a desk patient's record", () => {
    expect(isRedTeam("MSG-0950")).toBe(true);
    expect(isRedTeam("MSG-0152")).toBe(false);
    const c = caseOf("MSG-0950");
    expect(c.label).toBe(c.labelAsWritten);
    expect(c.result).toBe(c.ownResult);
    expect(c.got.route).toBe("draft");
    expect(c.routeCorrect).toBe(true);
  });

  it("the category compared is the result's category, including a rules-only stop", () => {
    const c = caseOf("MSG-0001");
    expect(c.got.category).toBe("adverse_event");
    expect(c.categoryCorrect).toBe(true);
  });

  it("a label without a result is reported as missing", () => {
    const { missing } = reviewCases(results, messages, [...labels, label("MSG-0099", "other", "person")]);
    expect(missing).toEqual(["MSG-0099"]);
  });
});
