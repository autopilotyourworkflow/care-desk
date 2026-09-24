/**
 * Rehearsal round 3, retrieval fixes (lib/pipeline/retrieve.ts), against the real handbook, patients and messages:
 *  - P3: a message, or another message from the same patient, that asks to add, remove or swap a product always gets
 *    the product-change section P6.1 (a change needs a clinician's approval; a new price applies from the next billing
 *    date once approved), whatever the category it was sorted as. MSG-0041 was sorted billing and MSG-0027 is a
 *    billing-date question sent after MSG-0011 asked to drop the capsules; both drafts quoted a new price "from the
 *    next billing date" without P6.1 among the sources.
 *  - Round-3 loose end: a script_renewal question on an order waiting for a script also gets that order and the last
 *    charge, as an order status question does, so "have I been charged for it yet?" is answered from the record
 *    (MSG-0155 with CHG-30019, MSG-0182 with CHG-30142).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Category, Patient, PatientMessage, PolicySection } from "@/lib/types";
import { redact } from "@/lib/pipeline/redact";
import { asksProductChange, PRODUCT_CHANGE_SECTION_ID, searchPolicy, selectRecords } from "@/lib/pipeline/retrieve";

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8")) as T;
}
const POLICY = readJson<{ sections: PolicySection[] } | PolicySection[]>("data/policy.json");
const SECTIONS: PolicySection[] = Array.isArray(POLICY) ? POLICY : POLICY.sections;
const PATIENTS = readJson<Patient[]>("data/patients.json");
const MESSAGES = readJson<PatientMessage[]>("data/messages.json");

const message = (id: string) => MESSAGES.find((x) => x.id === id)!;
const patientOf = (m: PatientMessage) => PATIENTS.find((x) => x.id === m.patientId)!;
function redacted(m: PatientMessage): string {
  return redact(m.subject ? `${m.subject}\n${m.body}` : m.body, patientOf(m)).redactedText;
}
/** What the pipeline searches with (run.ts), plus the patient's other messages when given. */
function search(messageId: string, category: Category, otherIds: string[] = []) {
  const m = message(messageId);
  const p = patientOf(m);
  const text = redacted(m);
  const records = selectRecords(p, category, text);
  const otherMessages = otherIds.map((id) => redacted(message(id)));
  return searchPolicy(text, category, p.country, 3, { sections: SECTIONS, records, otherMessages });
}
const ids = (refs: { id: string }[]) => refs.map((r) => r.id);

describe("retrieve: a product change always brings in P6.1 (rehearsal round 3, P3)", () => {
  it("MSG-0041, sorted billing: 'keep the oil and drop the capsules' gets P6.1", () => {
    expect(asksProductChange(message("MSG-0041").body)).toBe(true);
    const refs = search("MSG-0041", "billing");
    expect(ids(refs)).toContain(PRODUCT_CHANGE_SECTION_ID);
    expect(refs.find((r) => r.id === "P6.1")?.text).toContain("Adding, removing or swapping a product needs a clinician's approval");
  });

  it("MSG-0041 gets P6.1 as plan_change and price_change too", () => {
    for (const c of ["plan_change", "price_change"] as Category[]) expect(ids(search("MSG-0041", c))).toContain("P6.1");
  });

  it("MSG-0027: a billing-date question gets P6.1 when the patient's other message MSG-0011 asks to drop the capsules", () => {
    expect(asksProductChange(message("MSG-0027").body)).toBe(false);
    expect(asksProductChange(message("MSG-0011").body)).toBe(true);
    expect(ids(search("MSG-0027", "billing", ["MSG-0011"]))).toContain("P6.1");
  });

  it("the top 3 are kept as they were: P6.1 is only added after them", () => {
    const plain = ids(search("MSG-0027", "billing"));
    const withOther = ids(search("MSG-0027", "billing", ["MSG-0011"]));
    expect(plain).not.toContain("P6.1");
    expect(withOther).toEqual([...plain, "P6.1"]);
  });

  it("recognises the ways patients ask to add, remove or swap a product", () => {
    for (const t of [
      "I'd like to go down to one product from my next billing date on 3 October, please.",
      "I'll keep the oil and drop the capsules, purely to keep costs down.",
      "I'd like to drop the capsules from my plan and just keep the oil going.",
      "Can I add the spray to my plan?",
      "Could I swap the oil for capsules?",
      "Can I switch to the capsules instead?",
      "Please take the capsules off my plan.",
      "I'd like to add a second product.",
      "Can you remove the gummies?",
    ]) {
      expect(asksProductChange(t), t).toBe(true);
    }
  });

  it("does not fire on ordinary questions that name a product without changing it", () => {
    for (const t of [
      "Can I change my billing date to the 15th of each month?",
      "Will my October order have both the oil and the capsules in it, like September's did?",
      "Where is my oil? It still hasn't arrived.",
      "How should I store the capsules?",
      "Can I switch my consult to video?",
      "The drops bottle arrived leaking.",
    ]) {
      expect(asksProductChange(t), t).toBe(false);
    }
  });

  it("a message with no product change gets no extra section", () => {
    const refs = search("MSG-0027", "billing");
    expect(refs.length).toBeLessThanOrEqual(3);
  });

  it("a handbook without P6.1 is left alone", () => {
    const sections = SECTIONS.filter((s) => s.id !== "P6.1");
    const refs = searchPolicy("I'll keep the oil and drop the capsules.", "billing", "UK", 3, { sections });
    expect(ids(refs)).not.toContain("P6.1");
    expect(refs.length).toBeLessThanOrEqual(3);
  });
});

describe("retrieve: a script-pending renewal question gets the waiting order and the last charge (round-3 loose end)", () => {
  function records(messageId: string, category: Category) {
    const m = message(messageId);
    return selectRecords(patientOf(m), category, redacted(m));
  }

  it("MSG-0182 as script_renewal: the stuck order, the last charge and the consult that changed the script", () => {
    const refs = records("MSG-0182", "script_renewal");
    expect(ids(refs)).toEqual(expect.arrayContaining(["ORD-20136", "CHG-30142", "APT-40177", "PLAN"]));
    expect(refs.find((r) => r.id === "ORD-20136")?.text).toContain("waiting for script approval");
  });

  it("MSG-0155 as script_renewal: 'have I been charged for it yet?' gets the last charge", () => {
    const refs = records("MSG-0155", "script_renewal");
    expect(ids(refs)).toEqual(expect.arrayContaining(["ORD-20017", "CHG-30019", "PLAN"]));
  });

  it("an appointment question is unchanged: no charge is added for a script-pending order", () => {
    const m = message("MSG-0182");
    const p = patientOf(m);
    const appt = selectRecords(p, "appointment", "", { today: "2026-12-31" });
    expect(appt.some((r) => r.kind === "charge" && !/consult/i.test(r.text))).toBe(false);
  });
});
