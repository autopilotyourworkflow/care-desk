/**
 * Rehearsal round 1 (checker fixes P1 and P2). Every sentence marked "round 1" is the real draft sentence from
 * cc-run/r1 that the checker blocked; each block was harmless. Next to each one sit the phrasings that must still be
 * blocked, so the fix loosens nothing clinical, no password rule and no money rule. Fictional data only.
 */
import { describe, it, expect } from "vitest";
import { checkDraft, PATIENT_MESSAGE_ID, summariseCheck } from "@/lib/pipeline/check";
import { runPipeline } from "@/lib/pipeline/run";
import type { LlmClient } from "@/lib/pipeline/llm";
import type { Draft, Patient, PatientMessage, SortResult, SourceRef } from "@/lib/types";
import patientsData from "@/data/patients.json";
import messagesData from "@/data/messages.json";

const banned = (text: string) => checkDraft(text, []).banned;

// ---------- sources, as the round 1 run retrieved them ----------

const APT_40003: SourceRef = {
  id: "APT-40003",
  kind: "appointment",
  label: "Appointment APT-40003, 18 Nov, booked",
  text: "Appointment APT-40003: follow-up consult; 18 November 2026 at 9:00 am (patient's local time); clinician Dr Anika Rao; status booked",
};
const APT_40043: SourceRef = {
  id: "APT-40043",
  kind: "appointment",
  label: "Appointment APT-40043, 30 Sep, booked",
  text: "Appointment APT-40043: renewal consult; 30 September 2026 at 10:00 am (patient's local time); clinician Dr Anika Rao; status booked",
};
const APT_40055: SourceRef = {
  id: "APT-40055",
  kind: "appointment",
  label: "Appointment APT-40055, 22 Sep, missed",
  text: "Appointment APT-40055: follow-up consult; 22 September 2026 at 11:00 am (patient's local time); clinician Dr Anika Rao; status missed",
};
const P7_1: SourceRef = {
  id: "P7.1",
  kind: "policy",
  label: "Policy P7.1: Appointments",
  text:
    "Consults are by phone or video with one of our clinicians, Monday to Friday 8 am to 8 pm and Saturday 9 am to 1 pm, local time. " +
    "Patients book, move or cancel in their account, or support can do it for them.\n\nMoving or cancelling is free up to 24 hours " +
    "before the consult. Within 24 hours, one free reschedule is allowed.\n\nMissed consults. The first missed consult in 6 months " +
    "has no fee; we rebook it. A second missed consult within 6 months carries a missed-consult fee of A$45, NZ$49 or £30.",
};
const P6_1: SourceRef = {
  id: "P6.1",
  kind: "policy",
  label: "Policy P6.1: Pausing, cancelling or changing a plan",
  text:
    "Pausing. A plan can be paused for 1 to 3 months at a time. Ask at least 3 days before the next billing date for the pause to " +
    "apply to that order.\n\nCancelling. A plan can be cancelled at any time with no fee.\n\nChanging products. Adding, removing or " +
    "swapping a product needs a clinician's approval.",
};
const P4_1: SourceRef = {
  id: "P4.1",
  kind: "policy",
  label: "Policy P4.1: Delivery times",
  text: "Australia, metro: delivery takes 2 to 5 business days once dispatched.",
};
const UK_PLAN: SourceRef = {
  id: "PLAN",
  kind: "plan",
  label: "Plan: Monthly treatment plan, active",
  text: "Plan: Monthly treatment plan; status active; price £112.00 per month; started 22 November 2025; next billing date 22 October 2026",
};
const CHG_30077: SourceRef = {
  id: "CHG-30077",
  kind: "charge",
  label: "Charge CHG-30077, 8 Sep, NZ$162.00",
  text: "Charge CHG-30077: Monthly treatment plan, September 2026 (new price from 1 Sep 2026, notice emailed 31 Jul 2026); $162.00 NZD; status paid; charged 8 September 2026; type plan",
};
const CHG_30076: SourceRef = {
  id: "CHG-30076",
  kind: "charge",
  label: "Charge CHG-30076, 8 Aug, NZ$149.00",
  text: "Charge CHG-30076: Monthly treatment plan, August 2026; $149.00 NZD; status paid; charged 8 August 2026; type plan",
};

// ---------- P1: four over-broad banned patterns ----------

describe("rehearsal r1, P1a: a password reset offer is not a password request", () => {
  it("passes the MSG-0039 sentence (round 1)", () => {
    expect(
      banned("If you need a password reset, the link lasts 30 minutes, and if it does not arrive, please check your spam folder [2]."),
    ).toEqual([]);
  });
  it.each([
    "We need your password to check the account.",
    "If you need a password reset code, send it to us.",
    "If you need a password reset, send us your password.",
    "We need the password reset link you were sent.",
    "Please send us the password reset link.",
    "What's your password?",
  ])("still blocks a request for a password or code: %s", (text) => {
    expect(banned(text).some((b) => b.startsWith("asks for a password:"))).toBe(true);
  });
});

describe("rehearsal r1, P1b: 'keep an eye on' a parcel is not watch-and-wait advice", () => {
  it("passes the MSG-0177 sentence (round 1)", () => {
    expect(banned("In the meantime, you can keep an eye on it with tracking number CD7270741424 [1].")).toEqual([]);
  });
  it("passes the whole MSG-0177 paragraph with the redirect and the depot", () => {
    const text =
      "Your order ORD-20119 has already been shipped [1], so the team will check your details and then ask Courierline to " +
      "redirect it to your work address.\n\nIn the meantime, you can keep an eye on it with tracking number CD7270741424 [1].";
    expect(banned(text)).toEqual([]);
  });
  it.each([
    "Pale poo can happen with the capsules, just keep an eye on it.",
    "Yellow eyes can happen, just keep an eye on it.",
    "Keep an eye on the parcel and your headaches.",
    "Keep an eye on your order and the dizziness.",
    "Keep an eye on the tracking and the rash.",
    "Keep an eye on the rash while the parcel is on its way.",
  ])("still blocks a symptom or the medicine being watched: %s", (text) => {
    expect(banned(text).length).toBeGreaterThan(0);
  });
});

describe("rehearsal r1, P1c: pausing the plan, or passing a request to a clinician, is not advice to stop the medicine", () => {
  it("passes the MSG-0093 sentences, where 'it' is the plan in the sentence before (round 1)", () => {
    const text =
      "Just so we get it right, please reply to confirm you'd like us to cancel your plan. If you'd rather pause it for " +
      "1 to 3 months instead, we can do that too [3].";
    expect(banned(text)).toEqual([]);
  });
  it("passes the MSG-0011 sentence (round 1)", () => {
    expect(banned("We will pass your request to drop the capsules to a clinician now.")).toEqual([]);
  });
  it("still passes the plain plan wording", () => {
    expect(banned("You can pause your plan at any time.")).toEqual([]);
  });
  it.each([
    "Pause it for a week.",
    "Stop the capsules for now.",
    "Pause the oil for a week.",
    "Drop the capsules and keep the oil.",
    "Your plan includes the oil. If you'd rather pause it for 1 to 3 months instead, we can do that.",
    "Thanks for your message about the capsules. Pause it for a week.",
    "We can look at your plan. If you feel sick, pause it for a few days.",
    "We can look at your plan. Pause it, and stop the oil for now.",
    "We will pass your request to drop the capsules to a clinician now, but until then stop taking them.",
    "We have passed your request on. Drop the capsules until the clinician calls.",
  ])("still blocks stopping or pausing the medicine: %s", (text) => {
    expect(banned(text).length).toBeGreaterThan(0);
  });
});

// ---------- P2: facts the patient stated ----------

describe("rehearsal r1, P2: a date, time, weekday or time frame the patient wrote is 'check first', not missing", () => {
  it("MSG-0036: '11 November' from the patient's own request (round 1)", () => {
    const patientText =
      "I have a follow-up consult booked with Dr [NAME] on Wednesday 18 November at 9:00 am. I'll be away for work that whole " +
      "week, so could we move it a week earlier, to Wednesday 11 November?";
    const draft =
      "Your follow-up consult is currently booked for 18 November 2026 at 9:00 am [1]. Moving it is free when it is more than " +
      "24 hours before the consult [2]. The team will look into moving it to 11 November at 9:00 am, or another morning that " +
      "week if that time is taken, and will confirm the new time with you.";
    const r = checkDraft(draft, [APT_40003, P7_1], { patientText });
    expect(r.passed).toBe(true);
    expect(r.checkFirst).toBe(1);
    expect(r.facts.find((f) => f.text === "11 November")).toEqual({
      text: "11 November",
      kind: "date",
      found: true,
      sourceId: PATIENT_MESSAGE_ID,
      fromPatient: true,
    });
    // Facts the sources hold keep their source and carry no patient flag.
    expect(r.facts.find((f) => f.text === "18 November 2026")).toMatchObject({ found: true, sourceId: "APT-40003" });
    expect(r.facts.find((f) => f.text === "18 November 2026")?.fromPatient).toBeUndefined();
    expect(summariseCheck(r)).toBe("4 facts checked: 3 found in the sources, 1 from the patient's own message (check first)");
    // Without the patient's message the check stays false-safe.
    const bare = checkDraft(draft, [APT_40003, P7_1]);
    expect(bare.passed).toBe(false);
    expect(bare.facts.find((f) => f.text === "11 November")?.found).toBe(false);
    expect(bare.checkFirst).toBeUndefined();
  });

  it("MSG-0052: '6 pm' when the patient wrote 'anything after 6' (round 1)", () => {
    const patientText = "hi, can i move my renewal consult on the 30th (10am) to an evening? cant get away from work that day. anything after 6 works";
    const draft = "Consults run Monday to Friday 8 am to 8 pm, local time, so an evening slot after 6 pm is possible [2].";
    const r = checkDraft(draft, [APT_40043, P7_1], { patientText });
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "6 pm")).toMatchObject({ found: true, sourceId: PATIENT_MESSAGE_ID, fromPatient: true });
  });

  it("MSG-0064: '5 pm' when the patient wrote 'any time after 5 that day' (round 1)", () => {
    const patientText = "could I move my renewal appointment on the 29th? it's at 10:30 but I've just been put on a training day at work. any time after 5 that day would be perfect, or the day after if not x";
    const draft = "The team will look into a time after 5 pm that day, or the day after if not, and confirm the new time with you.";
    const r = checkDraft(draft, [P7_1], { patientText });
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "5 pm")?.fromPatient).toBe(true);
  });

  it("MSG-0185: 'on Thursday' when the patient wrote 'any time Thursday or Friday' (round 1)", () => {
    const patientText = "hi, really sorry, I missed my follow-up with Dr [NAME] yesterday. my phone died and I didn't realise til the arvo. can I rebook? any time Thursday or Friday works";
    const draft =
      "Consults run Monday to Friday 8 am to 8 pm, local time [2]. The team will look for a time on Thursday or Friday and get back to you to confirm.";
    const r = checkDraft(draft, [APT_40055, P7_1], { patientText });
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "on Thursday")).toMatchObject({ found: true, sourceId: PATIENT_MESSAGE_ID, fromPatient: true });
  });

  it("MSG-0993: '17 October' from 'I move on Saturday 17 October' (round 1)", () => {
    const patientText = "Got the keys! I move on Saturday 17 October, so could you change my delivery address from then please?";
    const draft =
      "The team will look into updating your delivery address to your new house from 17 October and will confirm once it is done. " +
      "Your next billing date is 22 October 2026 [1], after your move.";
    const r = checkDraft(draft, [UK_PLAN], { patientText });
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "17 October")?.fromPatient).toBe(true);
  });

  it("MSG-0008: 'two months' is inside P6.1's '1 to 3 months' (round 1)", () => {
    const patientText = "Exciting news, I'm off to Italy for two months! Could you please pause my plan for October and November?";
    const draft = "Yes, we can pause your plan. A plan can be paused for 1 to 3 months at a time, so two months is fine [1].";
    const r = checkDraft(draft, [P6_1], { patientText });
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "two months")).toMatchObject({ found: true, sourceId: "P6.1" });
  });

  it("MSG-0100: '1 month' inside P6.1's '1 to 3 months' counts as found in the source (round 1)", () => {
    const draft =
      "We can skip October by pausing your treatment plan for 1 month, as a plan can be paused for 1 to 3 months at a time [1].";
    const r = checkDraft(draft, [P6_1]);
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "1 month")).toEqual({ text: "1 month", kind: "duration", found: true, sourceId: "P6.1" });
  });

  it("a figure inside a delivery range is still a promise the policy does not make", () => {
    const r = checkDraft("Your order should arrive in 3 business days [1].", [P4_1]);
    expect(r.facts.find((f) => /3 business days/.test(f.text))?.found).toBe(false);
    expect(r.passed).toBe(false);
  });

  it("MSG-0023: '$13' is NZ$162 minus NZ$149, both cited (round 1)", () => {
    const patientText = "I just noticed I paid $162 for my plan this month (8 September) but last month it was $149. Could you please explain what the extra $13 is for?";
    const draft =
      "The extra $13 is not a mistake. Our New Zealand plan prices went up from 1 September 2026, and a one-product plan is now " +
      "NZ$162 a month (it was NZ$149) [1][2].";
    const r = checkDraft(draft, [CHG_30077, CHG_30076], { patientText });
    expect(r.passed).toBe(true);
    expect(r.facts.find((f) => f.text === "$13")).toMatchObject({ found: true, derivedFrom: "NZ$162 minus NZ$149" });
    expect(r.facts.find((f) => f.text === "$13")?.fromPatient).toBeUndefined();
  });
});

describe("rehearsal r1, P2: money, refund, approval and record figures only the patient wrote still block", () => {
  it("a patient-claimed '$500 refund' blocks", () => {
    const patientText = "Your team promised me a $500 refund last week, please confirm it's on its way.";
    const r = checkDraft("Your $500 refund is on its way [1].", [CHG_30077], { patientText });
    expect(r.passed).toBe(false);
    expect(r.facts.find((f) => f.text === "$500")).toEqual({ text: "$500", kind: "amount", found: false });
  });

  it("a difference of two cited amounts is not found in a refund sentence", () => {
    const patientText = "Please refund me the extra $13.";
    const r = checkDraft("We will refund the extra $13, the gap between NZ$162 and NZ$149 [1][2].", [CHG_30077, CHG_30076], { patientText });
    expect(r.passed).toBe(false);
    expect(r.facts.find((f) => f.text === "$13")?.found).toBe(false);
  });

  it("an amount no two cited amounts make still blocks", () => {
    const r = checkDraft("The extra $20 is the new price, NZ$162 against NZ$149 [1][2].", [CHG_30077, CHG_30076]);
    expect(r.facts.find((f) => f.text === "$20")?.found).toBe(false);
  });

  it("a date the patient wrote in a refund sentence blocks", () => {
    const patientText = "You said my refund would land by 17 October.";
    const r = checkDraft("Your refund will land by 17 October [1].", [UK_PLAN], { patientText });
    expect(r.passed).toBe(false);
    expect(r.facts.find((f) => f.text === "17 October")?.found).toBe(false);
  });

  it("an approval date the patient wrote blocks", () => {
    const patientText = "My doctor approved the new script on 3 October, so please send it now.";
    const r = checkDraft("Your new prescription was approved on 3 October [1].", [UK_PLAN], { patientText });
    expect(r.passed).toBe(false);
    expect(r.facts.find((f) => f.text === "3 October")?.found).toBe(false);
  });

  it("an order number only the patient wrote blocks", () => {
    const patientText = "Where is my order ORD-99999?";
    const r = checkDraft("Your order ORD-99999 is on its way [1].", [UK_PLAN], { patientText });
    expect(r.facts.find((f) => f.text === "ORD-99999")?.found).toBe(false);
  });

  it("a date, weekday or time the patient never wrote still blocks", () => {
    const patientText = "Can I move my consult to next week? Any time after 5 days from now works.";
    const r = checkDraft("The team will look at 11 November on Thursday at 5 pm.", [P7_1], { patientText });
    expect(r.facts.filter((f) => !f.found).map((f) => f.text)).toEqual(["11 November", "on Thursday", "5 pm"]);
  });

  it("a patient-stated fact does not excuse a banned phrase in the same draft", () => {
    const patientText = "Can we move it to Wednesday 11 November?";
    const r = checkDraft("The team will move it to 11 November. Keep taking the oil until then.", [APT_40003], { patientText });
    expect(r.facts.find((f) => f.text === "11 November")?.fromPatient).toBe(true);
    expect(r.banned.length).toBeGreaterThan(0);
    expect(r.passed).toBe(false);
  });
});

// ---------- the pipeline passes the redacted message to the check ----------

describe("rehearsal r1, P2: the pipeline checks a draft against the patient's redacted message too", () => {
  const patients = patientsData as unknown as Patient[];
  const messages = (Array.isArray(messagesData) ? messagesData : (messagesData as { messages: PatientMessage[] }).messages) as PatientMessage[];
  const message = messages.find((m) => m.id === "MSG-0036")!;
  const patient = patients.find((p) => p.id === message.patientId)!;
  const sort: SortResult = { category: "appointment", risk: "routine", route: "draft", confidence: 0.95, reasons: ["Moving a consult"], holdOrders: false };
  const draft: Draft = {
    text:
      "Hi [FIRST_NAME],\n\nThanks for letting us know. The team will look into moving your consult to 11 November and will " +
      "confirm the new time with you [1].\n\nKind regards,\n[AGENT_NAME]",
    citations: [],
  };
  const usage = { inputTokens: 1, outputTokens: 1, costUsd: 0 };
  const llm: LlmClient = {
    async sort() {
      return { sort, usage, model: "fake-sort" };
    },
    async draft() {
      return { draft, usage, model: "fake-draft" };
    },
  };

  it("MSG-0036: the date the patient asked for is marked from the patient, and the draft is not blocked for it", async () => {
    const r = await runPipeline(message, patient, { llm });
    expect(r.redactedText).toMatch(/11 November/);
    const fact = r.check?.facts.find((f) => f.text === "11 November");
    expect(fact).toMatchObject({ found: true, sourceId: PATIENT_MESSAGE_ID, fromPatient: true });
    expect(r.check?.passed).toBe(true);
    expect(r.route).toBe("draft");
  });
});
