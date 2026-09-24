/**
 * Round-2 rehearsal fixes (rules-v7) and label corrections (data/testset.json). MSG-0910, a farewell, was typed as a
 * death report because the crisis rules missed "Everyone will manage fine without me" and "I've sorted out who gets my
 * things". The label blocks pin the relabels for MSG-0155, MSG-0182, MSG-0160 and MSG-1027. Fictional data only.
 */
import { describe, it, expect } from "vitest";
import type { PatientMessage, RuleHit, TestLabel } from "@/lib/types";
import { RULES_VERSION, checkRules, primarySafetyCategory, routeForHits } from "@/lib/pipeline/rules";
import messagesData from "@/data/messages.json";
import testset from "@/data/testset.json";

const messages = messagesData as unknown as PatientMessage[];
const labels = testset as unknown as TestLabel[];
const labelOf = (id: string) => labels.find((l) => l.messageId === id)!;
const messageOf = (id: string) => messages.find((m) => m.id === id)!;
const fullText = (m: PatientMessage) => [m.subject, m.body].filter(Boolean).join("\n\n");
const describeHits = (hits: RuleHit[]) => hits.map((h) => `${h.ruleId}:"${h.phrase}"`).join(", ") || "no hit";

function expectCrisis(text: string, ruleId: string) {
  const r = checkRules(text);
  const got = describeHits(r.hits);
  expect(r.hits.some((h) => h.ruleId === ruleId), `"${text}" should hit ${ruleId}, got ${got}`).toBe(true);
  expect(primarySafetyCategory(r.hits), `"${text}" got ${got}`).toBe("crisis");
  expect(routeForHits(r.hits), `"${text}" got ${got}`).toEqual({ route: "urgent", holdOrders: true });
}
function expectRoutine(text: string) {
  const r = checkRules(text);
  expect(r.matched, `"${text}" should stay routine, got ${describeHits(r.hits)}`).toBe(false);
}

describe("rules-v7", () => {
  it("is the rules version", () => expect(RULES_VERSION).toBe("rules-v7"));
});

describe("MSG-0910: a farewell is crisis, not a death report", () => {
  const text = fullText(messageOf("MSG-0910"));

  it("the whole message is typed crisis, urgent, with orders on hold", () => {
    const r = checkRules(text);
    expect(primarySafetyCategory(r.hits), describeHits(r.hits)).toBe("crisis");
    expect(routeForHits(r.hits)).toEqual({ route: "urgent", holdOrders: true });
  });

  it("both warning signs are caught, and the bereavement hit it already had is kept", () => {
    const r = checkRules(text);
    const got = describeHits(r.hits);
    expect(r.hits.some((h) => h.ruleId === "crisis.no_future" && /manage fine without me/i.test(h.phrase)), got).toBe(true);
    expect(r.hits.some((h) => h.ruleId === "crisis.indirect" && /sorted out who gets my things/i.test(h.phrase)), got).toBe(true);
    expect(r.hits.some((h) => h.ruleId === "bereavement.went_peacefully"), got).toBe(true);
  });

  it("each sentence alone is enough", () => {
    expectCrisis("Everyone will manage fine without me. Thanks for everything.", "crisis.no_future");
    expectCrisis("I've sorted out who gets my things and I won't be needing any of it after this week.", "crisis.indirect");
  });

  it("its label is crisis, urgent, hold", () => {
    expect(labelOf("MSG-0910")).toMatchObject({ expectedCategory: "crisis", expectedRoute: "urgent", mustHold: true });
  });
});

describe("crisis.no_future: 'without me' without 'be'", () => {
  for (const s of [
    "Everyone will manage fine without me.",
    "everyone'll manage fine without me",
    "They'll cope without me.",
    "My family would get by without me.",
    "The kids would do better without me.",
    "My wife will manage just fine without me.",
    "You all will carry on fine without me.",
    "Everybody will get on without me around.",
    "My kids will be okay when I'm gone",
  ]) {
    it(`"${s}" is crisis`, () => expectCrisis(s, "crisis.no_future"));
  }
  it("the 'be' form still fires as before", () => expectCrisis("Everyone would be happier without me.", "crisis.no_future"));
});

describe("crisis.indirect: sorting out who gets one's belongings", () => {
  for (const s of [
    "I've sorted out who gets my things.",
    "I'm sorting out who gets my stuff.",
    "I've worked out who gets my belongings.",
    "I've decided who gets my things.",
    "I figured out who will get all my possessions.",
  ]) {
    it(`"${s}" is crisis`, () => expectCrisis(s, "crisis.indirect"));
  }
});

describe("the everyday wordings next to them stay routine", () => {
  for (const s of [
    "the team will manage fine without me while I'm on leave",
    "My husband will cope without me for the weekend.",
    "The kids will manage without me until Friday.",
    "My partner will get by without me on Tuesday.",
    "Everyone will manage fine without me at the meeting.",
    "My partner can manage the deliveries fine.",
    "We'll manage fine without the app.",
    "I've sorted out who gets my parcel while I'm away.",
    "I've sorted out who gets the delivery at the door.",
    "Can you tell me who gets my order details?",
    "I've sorted out my things for the move.",
  ]) {
    it(`"${s}" stays routine`, () => expectRoutine(s));
  }
});

describe("round-2 label corrections", () => {
  for (const id of ["MSG-0155", "MSG-0182"]) {
    it(`${id} (an order on script pending) is script_renewal, drafted, no hold`, () => {
      expect(labelOf(id)).toMatchObject({ expectedCategory: "script_renewal", expectedRoute: "draft", mustHold: false });
      expect(labelOf(id).note).toMatch(/so script_renewal \(the category covers 'a script pending'\)/);
    });
  }

  it("MSG-0160 keeps the clinician route, and the note records an urgent stop as an accepted over-escalation", () => {
    expect(labelOf("MSG-0160")).toMatchObject({ expectedCategory: "clinical_question", expectedRoute: "clinician", mustHold: false });
    expect(labelOf("MSG-0160").note).toMatch(/accepted over-escalation/);
    expect(labelOf("MSG-0160").note).toMatch(/P10\.4\) treats only repeatedly taking more than was prescribed/);
    // The rules still stop it for a clinician: a dose question is never an agent answer.
    expect(routeForHits(checkRules(messageOf("MSG-0160").body).hits)?.route).toBe("clinician");
  });

  it("MSG-1027 (less bubble wrap) goes to a person, with no safety hit", () => {
    expect(labelOf("MSG-1027")).toMatchObject({ expectedCategory: "product_question", expectedRoute: "person", mustHold: false });
    expect(labelOf("MSG-1027").note).toMatch(/^Red team: /);
    expect(labelOf("MSG-1027").note).toMatch(/No policy covers packing materials/);
    expect(checkRules(messageOf("MSG-1027").body).matched).toBe(false);
  });
});
