/**
 * Final round, fix P1 (a) to (e): five correct round-4 drafts that the fact check blocked, each sent to a person. Every
 * sentence marked "round 4" is the real blocked sentence from cc-run/r4; each whole draft is checked the way run.ts
 * checks it (records then policy, as the pipeline retrieves them, and the redacted message as patientText). Next to
 * each sit the phrasings that must still block, so nothing clinical, no dosing rule and no parcel-day rule is loosened.
 *  (a) MSG-0041  a product-change request passed to a clinician, with the rest of the request before the verb
 *  (b) MSG-0027  naming the patient's separate request to drop a product from the plan
 *  (c) MSG-0109  "have it delivered ... instead" is where the parcel goes, not when to take a dose
 *  (d) MSG-0185  "Monday to Friday" opening hours copied from P7.1, word for word
 *  (e) MSG-0066  the order record says "1 business day past its estimated delivery date", so the draft's fact is in it
 */
import { describe, expect, it } from "vitest";
import { checkDraft, clinicianReason, PATIENT_MESSAGE_ID } from "@/lib/pipeline/check";
import { lateNoteText, lateOrderNote, policyTextForCountry, selectRecords } from "@/lib/pipeline/retrieve";
import type { Category, Patient, PatientMessage, SourceRef } from "@/lib/types";
import policyData from "@/data/policy.json";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";

const MESSAGES: PatientMessage[] = (Array.isArray(messagesData) ? messagesData : (messagesData as { messages: PatientMessage[] }).messages) as PatientMessage[];
const PATIENTS: Patient[] = (Array.isArray(patientsData) ? patientsData : (patientsData as { patients: Patient[] }).patients) as Patient[];
const SECTIONS = policyData as { id: string; title: string; body: string }[];

/** A policy section as the pipeline gives it to the drafter and the check: this patient's country only. */
function policy(id: string, country: Patient["country"]): SourceRef {
  const s = SECTIONS.find((x) => x.id === id)!;
  return { id: s.id, kind: "policy", label: `Policy ${s.id}: ${s.title}`, text: policyTextForCountry(s.body, country) };
}

/** The round-4 sources for a message: its records (as of its receivedAt) and policy sections, in run.ts's order. */
function sourcesFor(id: string, category: Category, redactedText: string, recordIds: string[], policyIds: string[]): SourceRef[] {
  const m = MESSAGES.find((x) => x.id === id)!;
  const p = PATIENTS.find((x) => x.id === m.patientId)!;
  const records = selectRecords(p, category, redactedText, { asOf: m.receivedAt });
  return [...recordIds.map((r) => records.find((x) => x.id === r)!), ...policyIds.map((s) => policy(s, p.country))];
}

const banned = (text: string) => checkDraft(text, []).banned;

/** Every sentence must block, with the reason that sends it to a clinician. */
function expectClinicalBlock(texts: string[]) {
  for (const t of texts) {
    const r = checkDraft(t, []);
    expect(r.passed, t).toBe(false);
    expect(clinicianReason(r), t).not.toBeNull();
  }
}

// ---------- (a) MSG-0041 ----------

describe("final round P1 (a): the patient's product-change request passed to a clinician (MSG-0041)", () => {
  const patientText =
    "Going down to one product\n\nHello,\n\nI'd like to go down to one product from my next billing date on 3 October, please. I'll keep the oil and drop the capsules, purely to keep costs down.\n\nCould you let me know what my new monthly amount will be? I'm on the concession price at the moment.\n\nMany thanks,\n[NAME]";
  const draft =
    "Hi [FIRST_NAME],\n\nIf the change is approved, your concession price for one product would be £90 a month [3]. Removing a product from your plan needs a clinician's approval [4]. The team will pass your request to keep the oil and drop the capsules to a clinician. We cannot promise when the approval will happen. If it is approved, the change and the new price apply from the next billing date [4]. Until then, your plan stays at £131.00 per month [1].\n\nKind regards,\n[AGENT_NAME]";

  it("must pass: the blocked sentence (round 4)", () => {
    expect(banned("The team will pass your request to keep the oil and drop the capsules to a clinician.")).toEqual([]);
  });

  it("must pass: the whole MSG-0041 draft, with its round-4 sources", () => {
    const sources = sourcesFor("MSG-0041", "plan_change", patientText, ["PLAN", "ORD-20121"], ["P5.4", "P6.1", "P5.1"]);
    const r = checkDraft(draft, sources, { patientText });
    expect(r.banned).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("must pass: the same hand-over with other request words before the verb", () => {
    for (const t of [
      "We will pass your request to keep the oil and drop the capsules to a clinician now.",
      "We have sent your request to keep the oil and the spray and drop the capsules to one of our clinicians.",
      "We will pass your request to drop the capsules to a clinician now.",
    ]) {
      expect(banned(t), t).toEqual([]);
    }
  });

  it("must block: telling the patient to drop or stop the medicine, even next to a request or a clinician", () => {
    expectClinicalBlock([
      "You can drop the capsules.",
      "Drop the capsules and keep the oil.",
      "Keep the oil and drop the capsules.",
      "We have passed your request to a clinician and you can drop the capsules.",
      "We have sent your request to the clinician and skip the capsules until they call.",
      "The team will pass your request to keep the oil and drop the capsules.",
      "The team will pass your request to keep the oil and drop the capsules for a few days.",
      "We will pass your request to keep the oil and drop the capsules to a clinician, but until then stop taking them.",
      "We will pass your request to keep the oil and drop the capsules to a clinician. Until then, drop the capsules.",
      "We will pass your request to keep the oil, and drop the capsules until a clinician calls.",
      "We will pass your request to keep the oil and then drop the capsules to a clinician.",
    ]);
  });
});

// ---------- (b) MSG-0027 ----------

describe("final round P1 (b): naming the patient's separate request to drop a product from the plan (MSG-0027)", () => {
  const patientText =
    "Billing date\n\nHi,\n\nCan I change my billing date to the 15th of each month? I get paid on the 15th now with my new job and the 3rd is a bit tight. Next one is due 3 October so if it can change before that, even better.\n\nCheers\n[NAME]\n[PHONE]";
  const draft =
    "Hi [FIRST_NAME],\n\nYes, you can move your billing date, once every 3 months [5]. The first charge on the new date covers the days in between, pro rata [5].\n\nThe team will look into moving your billing date to the 15th and confirm the new date with you. I can't promise the change will be made before your next billing date of 3 October 2026 [3].\n\nThe team will also reply about your separate request to drop the capsules from your plan.\n\nKind regards,\n[AGENT_NAME]";

  it("must pass: the blocked sentence (round 4)", () => {
    expect(banned("The team will also reply about your separate request to drop the capsules from your plan.")).toEqual([]);
  });

  it("must pass: the whole MSG-0027 draft, with its round-4 sources", () => {
    const sources = sourcesFor("MSG-0027", "billing", patientText, ["CHG-30063", "CHG-30062", "PLAN"], ["P3.2", "P5.1", "P5.4"]);
    const r = checkDraft(draft, sources, { patientText });
    expect(r.banned).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("must pass: other ways of naming that request", () => {
    for (const t of [
      "The team will also reply about your earlier request to drop the capsules from your plan.",
      "Your request to drop the capsules from your plan is with the team.",
    ]) {
      expect(banned(t), t).toEqual([]);
    }
  });

  it("must block: dropping the medicine as advice, without a request noun right before it or 'from your plan' after it", () => {
    expectClinicalBlock([
      "You can drop the capsules.",
      "Drop the capsules for a few days.",
      "You can drop the capsules for a few days.",
      "Drop the capsules from your plan.",
      "You can drop the capsules from your plan for a few days.",
      "The team will reply about your request, and you can drop the capsules from your plan.",
      "Your separate request to drop the capsules for a few days is noted.",
      "Your request to drop the capsules from your plan is noted, but drop them for a few days anyway.",
      "Your separate request to drop the capsules from your plan is with the team. Until then, stop taking them.",
    ]);
  });
});

// ---------- (c) MSG-0109 ----------

describe("final round P1 (c): 'have it delivered ... instead' is where the parcel goes, not when to take it (MSG-0109)", () => {
  const patientText =
    "October order\n\nHello,\n\nCould you please tell me when my October order will be sent out? I'm heading down to Nelson to stay with my sister from the 8th of October for a couple of weeks, and I'd like to have it before I go if possible.\n\nMany thanks,\n[NAME]";
  const draft =
    "Hi [FIRST_NAME],\n\nYour October order will be placed on your billing date, 1 October 2026, and repeat orders are usually dispatched 1 to 2 business days after the billing date [2][3]. I cannot promise it will reach you before you leave, so the team will check the delivery time and confirm.\n\nIf it is easier, you can have it delivered to your sister's address instead. You can change your address in your account or by message after an identity check, and a change made before dispatch applies to that order [5]. Someone will need to sign for it, as prescription medicines need a signature [5].\n\nKind regards,\n[AGENT_NAME]";

  it("must pass: the blocked sentence (round 4)", () => {
    expect(banned("If it is easier, you can have it delivered to your sister's address instead.")).toEqual([]);
  });

  it("must pass: the whole MSG-0109 draft, with its round-4 sources", () => {
    const sources = sourcesFor("MSG-0109", "order_status", patientText, ["ORD-20080", "PLAN"], ["P3.1", "P4.2", "P4.3"]);
    const r = checkDraft(draft, sources, { patientText });
    expect(r.banned).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("must pass: the other delivery verbs", () => {
    for (const t of [
      "You can have them sent to your work address instead.",
      "You could have it redirected to your neighbour's place instead.",
      "We can have it posted to your new address instead.",
      "You can have it shipped to your sister's instead.",
      "You can have it dispatched to your work address instead.",
      "You can have it forwarded to your new address instead.",
      "You can have it collected from the depot instead.",
    ]) {
      expect(banned(t), t).toEqual([]);
    }
  });

  it("must block: when to take it, with no medicine word needed", () => {
    expectClinicalBlock([
      "Have it at night instead.",
      "Take it in the morning instead.",
      "You can have it at night instead.",
      "Try it in the morning instead.",
      "Have them with food instead.",
      "You can have it twice a day.",
      "You can have it delivered to your sister's and take it at night instead.",
      "Have the oil at night instead.",
    ]);
  });
});

// ---------- (d) MSG-0185 ----------

describe("final round P1 (d): a weekday range copied from P7.1, word for word, is opening hours (MSG-0185)", () => {
  const patientText =
    "hi, really sorry, I missed my follow-up with Dr [NAME] yesterday. my phone died and I didn't realise til the arvo. can I rebook? any time Thursday or Friday works";
  const draft =
    "No worries, [FIRST_NAME], you can rebook, and support can book it for you [4]. Consults run Monday to Friday 8 am to 8 pm, local time, so the team will look for a Thursday or Friday time and confirm it with you [4]. The first missed consult in 6 months has no fee, and the team will check this for you and confirm [4].\n[AGENT_NAME]";
  const P7_1 = policy("P7.1", "AU");

  it("must pass: the blocked sentence against P7.1 (round 4)", () => {
    const r = checkDraft(
      "Consults run Monday to Friday 8 am to 8 pm, local time, so the team will look for a Thursday or Friday time and confirm it with you [4].",
      [P7_1],
      { patientText },
    );
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "Monday")).toMatchObject({ found: true, sourceId: "P7.1" });
  });

  it("must pass: the whole MSG-0185 draft, with its round-4 sources", () => {
    const sources = sourcesFor("MSG-0185", "appointment", patientText, ["APT-40055", "PLAN", "ORD-20048"], ["P7.1", "P2.1", "P4.3"]);
    const r = checkDraft(draft, sources, { patientText });
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "Monday")).toMatchObject({ found: true, sourceId: "P7.1" });
    // The lone "Friday" (the time the patient asked for) is checked on its own: from the patient, check first.
    expect(r.facts.filter((f) => f.text === "Friday").map((f) => f.sourceId)).toEqual(["P7.1", PATIENT_MESSAGE_ID]);
  });

  it("must block: a lone weekday for a parcel never matches a policy, even next to the opening hours", () => {
    for (const t of [
      "It will arrive on Monday.",
      "Your parcel will arrive Monday.",
      "Consults run Monday to Friday 8 am to 8 pm, and your parcel will arrive Friday.",
      "Consults run Monday to Friday 8 am to 8 pm, so your order will be dispatched on Monday.",
    ]) {
      const r = checkDraft(t, [P7_1]);
      expect(r.passed, t).toBe(false);
    }
    const r = checkDraft("Consults run Monday to Friday 8 am to 8 pm, and your parcel will arrive Friday.", [P7_1]);
    expect(r.facts.filter((f) => f.text === "Friday").map((f) => f.found)).toEqual([true, false]);
  });

  it("must block: a range the policy does not have word for word", () => {
    for (const t of [
      "Consults run Monday to Saturday, so the team will confirm a time with you.",
      "Consults run Monday-Friday, so the team will confirm a time with you.",
      "Your parcel will arrive Tuesday to Thursday.",
    ]) {
      expect(checkDraft(t, [P7_1]).passed, t).toBe(false);
    }
  });
});

// ---------- (e) MSG-0066 ----------

describe("final round P1 (e): the order record states the lateness, so the draft's '1 business day past' is found in it (MSG-0066)", () => {
  const patientText =
    "Which courier and tracking number\n\nHello,\n\nI have order from 17 September. Which courier is delivering it? Please can you send me the tracking number, I did not find any email with it.\n\nThank you\n[NAME]\n[PHONE]";
  const draft =
    "Hi [FIRST_NAME],\n\nYour order ORD-20103 is being delivered by Courierline, and the tracking number is CD9599249567 [1]. It was placed on 17 September 2026 and shipped on 18 September 2026 [1].\n\nThe estimated delivery date was 22 September 2026, and the order is now 1 business day past that date [1]. Courierline needs a signature on delivery [3]. If nobody is home, they leave a card and hold the parcel at the local depot for 5 business days, and you can book a free redelivery or collect it with photo ID using the tracking link [5].\n\nThe tracking link is normally in the dispatch email [3], so the team will look into why it did not reach you.\n\nKind regards,\n[AGENT_NAME]";
  const sources = sourcesFor("MSG-0066", "order_status", patientText, ["ORD-20103", "PLAN"], ["P4.1", "P3.1", "P4.3"]);

  it("the note says '1 business day', or 'N business days'", () => {
    expect(lateNoteText(1)).toMatch(/^1 business day past its estimated delivery date\b/);
    expect(lateNoteText(2)).toMatch(/^2 business days past its estimated delivery date\b/);
    expect(lateNoteText(3)).toMatch(/^3 business days past/);
    const m = MESSAGES.find((x) => x.id === "MSG-0066")!;
    const order = PATIENTS.find((x) => x.id === m.patientId)!.orders!.find((o) => o.id === "ORD-20103")!;
    expect(sources[0].text).toContain(`; ${lateOrderNote(order, m.receivedAt)}`);
    expect(sources[0].text).toContain("1 business day past its estimated delivery date");
  });

  it("must pass: the whole MSG-0066 draft, with '1 business day' found in the order it cites (round 4)", () => {
    const r = checkDraft(draft, sources, { patientText });
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "1 business day")).toMatchObject({ found: true, sourceId: "ORD-20103" });
  });

  it("MSG-0169 and MSG-0181 find the lateness in their own order, not in a policy line", () => {
    const m = MESSAGES.find((x) => x.id === "MSG-0169")!;
    const p = PATIENTS.find((x) => x.id === m.patientId)!;
    const own = selectRecords(p, "delivery_problem", "", { asOf: m.receivedAt }).find((x) => x.id === "ORD-20036")!;
    const r = checkDraft(
      "Your order ORD-20036 is still with Courierline and is 1 business day past its estimated delivery date of 22 September 2026 [1].",
      [own, policy("P4.3", p.country), policy("P4.1", p.country), policy("P4.2", p.country)],
    );
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "1 business day")).toMatchObject({ found: true, sourceId: "ORD-20036" });
    const r181 = checkDraft("It is now 1 business day past that date [1].", sources);
    expect(r181.facts.find((f) => f.text === "1 business day")).toMatchObject({ found: true, sourceId: "ORD-20103" });
  });

  it("must block: the lateness figure never supports a promise, and a wrong count is not found", () => {
    for (const t of [
      "Your parcel should arrive in 1 business day [1].",
      "It should be with you within 1 business day [1].",
      "Courierline will deliver it 1 business day from now [1].",
      "It is now 2 business days past its estimated delivery date [1].",
      "It is 1 business day past its estimated delivery date, so it should arrive in 1 business day [1].",
    ]) {
      expect(checkDraft(t, sources).passed, t).toBe(false);
    }
    // The same figure as lateness and as a promise is checked twice: the promise is not found.
    const r = checkDraft("It is 1 business day past its estimated delivery date, and it will arrive 1 business day from now [1].", sources);
    expect(r.facts.filter((f) => f.text === "1 business day").map((f) => f.found)).toEqual([true, false]);
  });

  it("must block: P4.2's lateness steps are not a delivery promise either", () => {
    const P4_2 = policy("P4.2", "UK");
    expect(checkDraft("It should arrive in 2 business days [1].", [P4_2]).passed).toBe(false);
    expect(checkDraft("It will be with you within 5 business days [1].", [P4_2]).passed).toBe(false);
    // The steps themselves, as a draft restates them, still match.
    expect(checkDraft("If it reaches 2 business days past the estimated date, the team will open a trace with Courierline [1].", [P4_2]).passed).toBe(true);
    expect(checkDraft("A trace takes up to 3 business days [1].", [P4_2]).passed).toBe(true);
  });
});
