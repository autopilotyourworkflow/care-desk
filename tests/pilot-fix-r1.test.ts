/**
 * Paid-run pilot, fix round 1 (prompts-v8): the code-side fixes, run on the real modules with the demo data.
 *  - an order delivered shortly before the message says how many days ago, worked out in code (MSG-0950)
 *  - dates inside charge descriptions and hold reasons are written with the full month (MSG-0034, MSG-0078)
 *  - an order past its ETA always brings the late-orders section (P4.2), and "a second box of capsules" the
 *    product-change section (P6.1) (MSG-0077)
 *  - words aimed at the AI or the triage are named in the trail even when the sorter already chose a person (MSG-0930)
 * Fictional data only.
 */
import { describe, expect, it } from "vitest";
import type { Draft, Patient, PatientMessage, SortResult } from "@/lib/types";
import {
  asksProductChange,
  deliveredNote,
  fullMonthDates,
  searchPolicy,
  selectRecords,
} from "@/lib/pipeline/retrieve";
import { runPipeline } from "@/lib/pipeline/run";
import type { LlmClient } from "@/lib/pipeline/llm";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";

const MESSAGES = (Array.isArray(messagesData) ? messagesData : (messagesData as { messages: PatientMessage[] }).messages) as PatientMessage[];
const PATIENTS = (Array.isArray(patientsData) ? patientsData : (patientsData as { patients: Patient[] }).patients) as Patient[];
const messageById = (id: string) => MESSAGES.find((m) => m.id === id)!;
const patientOf = (m: PatientMessage) => PATIENTS.find((p) => p.id === m.patientId)!;

describe("deliveredNote: days since delivery, worked out in code (MSG-0950)", () => {
  const m = messageById("MSG-0950"); // received 24 September 2026
  const p = patientOf(m);
  const order = p.orders!.find((o) => o.id === "ORD-20126")!; // delivered 18 September 2026

  it("ORD-20126 was delivered 6 days before the message", () => {
    expect(deliveredNote(order, m.receivedAt)).toBe("6 days since delivery as of this message (calendar days)");
  });

  it("says nothing without a date, on the delivery day, after 30 days, or for an order not delivered", () => {
    expect(deliveredNote(order, undefined)).toBeUndefined();
    expect(deliveredNote(order, "2026-09-18T20:00:00+01:00")).toBeUndefined();
    expect(deliveredNote(order, "2026-10-19T09:00:00+01:00")).toBeUndefined();
    expect(deliveredNote(order, "2026-10-18T09:00:00+01:00")).toMatch(/^30 days since delivery/);
    expect(deliveredNote({ ...order, status: "shipped" }, m.receivedAt)).toBeUndefined();
  });

  it("selectRecords appends it to the delivered order when given the message's date", () => {
    const rec = selectRecords(p, "delivery_problem", m.body, { asOf: m.receivedAt }).find((r) => r.id === "ORD-20126")!;
    expect(rec.text).toMatch(/; 6 days since delivery as of this message \(calendar days\)$/);
    const plain = selectRecords(p, "delivery_problem", m.body).find((r) => r.id === "ORD-20126")!;
    expect(plain.text).not.toContain("since delivery");
  });
});

describe("fullMonthDates: record text never mixes '1 Sep 2026' with '8 September 2026' (MSG-0034)", () => {
  it("writes day-month-year dates with the full month and leaves the rest alone", () => {
    expect(fullMonthDates("concession re-verification was due 1 Sep 2026 and was not completed")).toBe(
      "concession re-verification was due 1 September 2026 and was not completed",
    );
    expect(fullMonthDates("Retried on 17 Sep 2026 and 20 Sept 2026.")).toBe("Retried on 17 September 2026 and 20 September 2026.");
    expect(fullMonthDates("Monthly treatment plan, September 2026")).toBe("Monthly treatment plan, September 2026");
    expect(fullMonthDates("due 1 September 2026")).toBe("due 1 September 2026");
  });

  it("the MSG-0034 charge record carries the full date", () => {
    const m = messageById("MSG-0034");
    const recs = selectRecords(patientOf(m), "price_change", m.body, { asOf: m.receivedAt });
    const all = recs.map((r) => r.text).join("\n");
    expect(all).not.toMatch(/\b\d{1,2} Sep 2026\b/);
  });
});

describe("required policy sections (MSG-0077)", () => {
  const m = messageById("MSG-0077");
  const p = patientOf(m);

  it("an order past its ETA brings the late-orders section, and a second box of capsules the product-change section", () => {
    const records = selectRecords(p, "order_status", m.body, { asOf: m.receivedAt });
    expect(records.some((r) => /past its estimated delivery date/.test(r.text))).toBe(true);
    const ids = searchPolicy(m.body, "order_status", p.country, 3, { records }).map((r) => r.id);
    expect(ids).toContain("P4.2");
    expect(ids).toContain("P6.1");
  });

  it("without the past-ETA line, P4.2 is not forced in", () => {
    const records = selectRecords(p, "order_status", m.body);
    const ids = searchPolicy("just wondering where my order's up to?", "order_status", p.country, 3, { records }).map((r) => r.id);
    expect(ids).toHaveLength(3);
  });

  it("asksProductChange reads a box or bottle of a product", () => {
    expect(asksProductChange("can i add a second box of capsules to it??")).toBe(true);
    expect(asksProductChange("could you add another bottle of the oil")).toBe(true);
    expect(asksProductChange("the box of capsules arrived squashed")).toBe(false);
  });
});

describe("the trail names words aimed at the AI even when the sorter chose a person (MSG-0930)", () => {
  const m = messageById("MSG-0930");
  const p = patientOf(m);
  const personSort: SortResult = {
    category: "billing",
    risk: "routine",
    route: "person",
    confidence: 0.95,
    reasons: ["Claims a staff approval"],
    holdOrders: false,
  };
  const draft: Draft = { text: "", citations: [] };
  const usage = { inputTokens: 1, outputTokens: 1, costUsd: 0 };
  const llm: LlmClient = {
    async sort() {
      return { sort: personSort, usage, model: "fake-sort" };
    },
    async draft() {
      return { draft, usage, model: "fake-draft" };
    },
  };

  it("routes to a person and quotes the instruction in the sort step", async () => {
    const r = await runPipeline(m, p, { llm });
    expect(r.route).toBe("person");
    const summary = r.trail.find((s) => s.id === "sort")?.summary ?? "";
    expect(summary).toMatch(/^Billing \(95% sure\), and the message tells the AI or the triage what to do \(/);
    expect(summary).toMatch(/A person will reply\./);
  });
});
