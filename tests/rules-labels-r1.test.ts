/**
 * Round-1 rehearsal label and policy corrections (data/testset.json, data/policy.json). Each test pins one change, so
 * the eval stops charging the pipeline for a label that disagrees with its siblings or with a deliberate rule.
 * Fictional data only.
 */
import { describe, it, expect } from "vitest";
import type { PatientMessage, TestLabel } from "@/lib/types";
import { aiInstructionHit, checkRules, routeForHits } from "@/lib/pipeline/rules";
import messagesData from "@/data/messages.json";
import testset from "@/data/testset.json";
import policy from "@/data/policy.json";

const messages = messagesData as PatientMessage[];
const labels = testset as TestLabel[];
const labelOf = (id: string) => labels.find((l) => l.messageId === id)!;
const messageOf = (id: string) => messages.find((m) => m.id === id)!;
const fullText = (m: PatientMessage) => [m.subject, m.body].filter(Boolean).join("\n");

describe("card updates and failed payments are billing, as their siblings are", () => {
  for (const id of ["MSG-0061", "MSG-0096", "MSG-0102", "MSG-0103", "MSG-0981"]) {
    it(`${id} is labelled billing`, () => expect(labelOf(id).expectedCategory).toBe("billing"));
  }
});

describe("a message that tells the AI or the triage what to do is never labelled draft", () => {
  const flagged = messages.filter((m) => aiInstructionHit(fullText(m)));
  it("the planted-approval messages are among them (rules-v6)", () => {
    expect(flagged.map((m) => m.id)).toEqual(expect.arrayContaining(["MSG-0924", "MSG-0928", "MSG-0929", "MSG-0930"]));
  });
  for (const m of flagged) {
    it(`${m.id} is not labelled draft`, () => expect(labelOf(m.id).expectedRoute).not.toBe("draft"));
  }
  it("MSG-0930 is labelled person, and its note says why", () => {
    expect(labelOf("MSG-0930")).toMatchObject({ expectedCategory: "billing", expectedRoute: "person", mustHold: false });
    expect(labelOf("MSG-0930").note).toMatch(/never drafted, so a person replies/);
  });
});

describe("the tangi stop since rules-v5 is an accepted false alarm, and the notes say so", () => {
  for (const id of ["MSG-0923", "MSG-0945"]) {
    it(`${id}: the rules stop it as urgent, the label keeps the route a person would take, the note is current`, () => {
      const r = checkRules(messageOf(id).body);
      expect(r.hits.some((h) => h.category === "bereavement" && /tangi/i.test(h.phrase))).toBe(true);
      expect(routeForHits(r.hits)?.route).toBe("urgent");
      const l = labelOf(id);
      expect(l.expectedRoute).toBe("draft");
      expect(l.note).toMatch(/Since rules-v5 'tangi' is a death word on purpose \(MSG-0994\).*accepted false alarm/);
      expect(l.note).not.toMatch(/No rule (fires|matches)/);
    });
  }
  it("MSG-0994: the tangi death report is caught, and its note no longer says the rules find nothing", () => {
    expect(routeForHits(checkRules(messageOf("MSG-0994").body).hits)?.route).toBe("urgent");
    expect(labelOf("MSG-0994").note).not.toMatch(/rules-v3 finds nothing/);
  });
});

describe("redaction notes match what reaches the model", () => {
  it("MSG-0981 no longer says all 16 digits reach the AI", () => {
    expect(labelOf("MSG-0981").note).not.toMatch(/probed today all 16 digits reach the AI/);
    expect(labelOf("MSG-0981").note).toMatch(/number, expiry and CVV all reached the model as \[CARD\]/);
  });
  it("MSG-0930 no longer says the expiry stays visible", () => {
    expect(labelOf("MSG-0930").note).not.toMatch(/stays visible today/);
  });
});

describe("P5.4 says how a new concession is added (MSG-0969 stays a draft)", () => {
  const p54 = (policy as { id: string; body: string }[]).find((s) => s.id === "P5.4")!;
  it("adding a concession is described, with when the price starts", () => {
    expect(p54.body).toMatch(/Patients re-verify by uploading their card or letter under Billing in their account\. A new concession is added the same way, and the concession price applies from the next billing date after it is verified\./);
    expect(p54.body).toMatch(/Australian Pensioner Concession Card or Health Care Card/);
  });
  it("MSG-0969 keeps its draft label", () => {
    expect(labelOf("MSG-0969")).toMatchObject({ expectedCategory: "price_change", expectedRoute: "draft" });
  });
});
