/**
 * Rehearsal round 2, retrieval fix (P3 in the round-1 findings), against the real handbook, patients and messages:
 *  - "Australian" before a proper name is an AU country marker, so an Australian patient keeps the P5.4
 *    concession-eligibility sentence (MSG-0969, MSG-0010), while "Use Australian or British spelling" stays a rule for
 *    everyone.
 *  - order_status and delivery_problem questions about not being home, signing, the depot, a held parcel or collecting
 *    it find P4.3 (MSG-0951), and delivery-timing questions find P4.1, UK included (MSG-0097).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Category, Patient, PatientMessage, PolicySection, TestLabel } from "@/lib/types";
import { redact } from "@/lib/pipeline/redact";
import { policyTextForCountry, searchPolicy, selectRecords } from "@/lib/pipeline/retrieve";

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8")) as T;
}
const POLICY = readJson<{ sections: PolicySection[] } | PolicySection[]>("data/policy.json");
const SECTIONS: PolicySection[] = Array.isArray(POLICY) ? POLICY : POLICY.sections;
const PATIENTS = readJson<Patient[]>("data/patients.json");
const MESSAGES = readJson<PatientMessage[]>("data/messages.json");
const LABELS = readJson<TestLabel[]>("data/testset.json");
const section = (id: string) => SECTIONS.find((s) => s.id === id)!;

/** What the pipeline searches with (run.ts): the redacted subject and body, plus the records chosen for the reply. */
function search(messageId: string, category?: Category) {
  const m = MESSAGES.find((x) => x.id === messageId)!;
  const p = PATIENTS.find((x) => x.id === m.patientId)!;
  const cat = category ?? LABELS.find((l) => l.messageId === messageId)!.expectedCategory;
  const { redactedText } = redact(m.subject ? `${m.subject}\n${m.body}` : m.body, p);
  const records = selectRecords(p, cat, redactedText);
  return searchPolicy(redactedText, cat, p.country, 3, { sections: SECTIONS, records });
}
const ids = (refs: { id: string }[]) => refs.map((r) => r.id);

const ELIGIBILITY = "About 20% off for holders of an Australian Pensioner Concession Card or Health Care Card";

describe("retrieve: 'Australian' marks the AU concession sentence", () => {
  it("an Australian patient keeps the P5.4 eligibility sentence, and still sees no other country's prices", () => {
    const au = policyTextForCountry(section("P5.4").body, "AU");
    // Round 1 (MSG-0969): the AU text jumped from "Concessions." straight to "A concession is verified...".
    expect(au).toContain(`Concessions. ${ELIGIBILITY}`);
    expect(au).toContain("concession A$118 and A$171");
    expect(au).not.toMatch(/£|NZ\$|The New Zealand change/);
  });

  it("NZ and UK patients keep the same eligibility sentence, with their own prices only", () => {
    const nz = policyTextForCountry(section("P5.4").body, "NZ");
    expect(nz).toContain("a New Zealand Community Services Card");
    expect(nz).not.toMatch(/A\$|£/);
    const uk = policyTextForCountry(section("P5.4").body, "UK");
    expect(uk).toContain("in the UK, proof of a means-tested benefit such as Universal Credit");
    expect(uk).not.toMatch(/A\$|NZ\$/);
  });

  it("a bare adjective is not a marker: the spelling rule stays for everyone", () => {
    for (const c of ["AU", "NZ", "UK"] as const) expect(policyTextForCountry(section("P1.2").body, c)).toBe(section("P1.2").body);
    expect(policyTextForCountry("Use Australian or British spelling. New Zealand: 3 days.", "UK")).toBe("Use Australian or British spelling.");
    // Before a proper name it names Australia: dropped for the others, kept for AU.
    expect(policyTextForCountry("Holders of an Australian Health Care Card get 20% off. Shared text.", "NZ")).toBe("Shared text.");
    expect(policyTextForCountry("Holders of an Australian Health Care Card get 20% off. Shared text.", "AU")).toBe(
      "Holders of an Australian Health Care Card get 20% off. Shared text.",
    );
  });

  it.each(["MSG-0969", "MSG-0010"])("%s (AU concession question) gets P5.4 with the eligibility sentence", (id) => {
    const p54 = search(id).find((r) => r.id === "P5.4");
    expect(p54).toBeDefined();
    expect(p54!.text).toContain(ELIGIBILITY);
    expect(p54!.text).not.toMatch(/£|NZ\$/);
  });
});

describe("retrieve: missed deliveries, signatures and the depot (P4.3) for order and delivery questions", () => {
  it("MSG-0951: 'will it just sit at the depot until I'm back on Tuesday?' gets P4.3 with the depot rule", () => {
    const refs = search("MSG-0951");
    expect(ids(refs)).toContain("P4.3");
    expect(refs.find((r) => r.id === "P4.3")!.text).toContain("holds the parcel at the local depot for 5 business days");
    // The delivery window stays too ("Tracking says it's due tomorrow").
    expect(ids(refs)).toContain("P4.1");
    // The damaged-item follow-up no longer crowds it out with product questions.
    expect(ids(refs)).not.toContain("P11.1");
  });

  it.each([
    ["MSG-0105", "order_status"], // "Just want to make sure someone's home to sign for it."
    ["MSG-0173", "order_status"], // "I'd like to make sure someone's home to sign for it."
    ["MSG-0184", "order_status"], // "Need to know if I should work from home to sign for it."
    ["MSG-0018", "order_status"], // "need to know if I should be in to sign for it"
    ["MSG-0021", "delivery_problem"], // "Got a card from Courierline saying they missed me"
    ["MSG-0062", "delivery_problem"], // "card in the letterbox saying nobody was home"
  ] as [string, Category][])("%s (%s) gets P4.3", (id, cat) => {
    expect(ids(search(id, cat))).toContain("P4.3");
  });

  it.each(["order_status", "delivery_problem"] as Category[])("plain %s phrasings of not home, sign, depot, held and collect find P4.3", (cat) => {
    for (const q of [
      "I won't be home on Thursday, what happens to my parcel?",
      "nobody will be home when the courier comes",
      "does someone have to sign for it?",
      "is it being held at the post office?",
      "can I collect it myself instead?",
      "can I pick it up from the depot?",
    ]) {
      expect(ids(searchPolicy(q, cat, "AU", 3, SECTIONS)), q).toContain("P4.3");
    }
  });

  it("a script hold is not a held parcel: MSG-0155 and MSG-0182 (orders held until a prescription is approved) do not get P4.3", () => {
    // Their record hint reads "held until the new prescription is approved".
    expect(ids(search("MSG-0155", "order_status"))).not.toContain("P4.3");
    expect(ids(search("MSG-0182", "order_status"))).not.toContain("P4.3");
  });

  it("'no sign of it' is not a signature question", () => {
    const withIdiom = searchPolicy("there's no sign of it anywhere", "delivery_problem", "AU", 5, SECTIONS);
    const withSign = searchPolicy("does someone need to sign for it", "delivery_problem", "AU", 5, SECTIONS);
    const score = (refs: { id: string; score?: number }[]) => refs.find((r) => r.id === "P4.3")?.score ?? 0;
    expect(score(withSign)).toBeGreaterThan(score(withIdiom) + 3);
  });

  it("MSG-0923: a redirect keeps the identity-check section (P8.1) in reach next to P4.3", () => {
    const refs = ids(search("MSG-0923", "delivery_problem"));
    expect(refs).toContain("P4.3");
    expect(refs).toContain("P8.1");
  });
});

describe("retrieve: delivery windows (P4.1) for timing questions, UK included", () => {
  it("MSG-0097 (UK): 'still goes out on the 7th... off on holiday' gets the UK window and the missed-delivery rule", () => {
    const refs = search("MSG-0097");
    expect(ids(refs)).toEqual(expect.arrayContaining(["P4.1", "P4.3"]));
    const p41 = refs.find((r) => r.id === "P4.1")!;
    expect(p41.text).toContain("United Kingdom, mainland: 1 to 2 business days");
    expect(p41.text).not.toMatch(/Australia|New Zealand/);
    // Nothing about late or lost parcels: this order is not late.
    expect(ids(refs)).not.toContain("P4.2");
  });

  it.each([
    "MSG-0029", // "when's my next order coming?"
    "MSG-0076", // "when's my next order due?"
    "MSG-0082", // "roughly when will it get here"
    "MSG-0088", // "when will ORD-20046 ship?"
    "MSG-0147", // "when will ORD-20062 get to [ADDRESS]?"
    "MSG-0152", // "heading away from friday so just want to know if it'll get here before then"
    "MSG-0154", // "when will it actually ship?"
    "MSG-0175", // "when will ORD-20119 get here?" (UK)
  ])("%s gets P4.1", (id) => {
    expect(ids(search(id, "order_status"))).toContain("P4.1");
  });

  it("a timing question never pulls in the urgent protocols", () => {
    for (const id of ["MSG-0097", "MSG-0951", "MSG-0152"]) {
      for (const cat of ["order_status", "delivery_problem"] as Category[]) {
        expect(ids(search(id, cat)).some((x) => x.startsWith("P10."))).toBe(false);
      }
    }
  });
});
