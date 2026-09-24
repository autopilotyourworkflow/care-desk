/**
 * Safety families from the second red-team round, one block per family. Each block proves the deterministic layer
 * catches the general pattern (not one string) and that the everyday wording next to it stays routine. The last blocks
 * run the real red-team messages through the pipeline and check the whole routine corpus for new false alarms.
 * Fictional data only.
 */
import { describe, it, expect } from "vitest";
import type { Patient, PatientMessage, RuleHit, TestLabel } from "@/lib/types";
import { checkRules, routeForHits } from "@/lib/pipeline/rules";
import { RELATIVE_DEATH_RULE_ID, LIVING_PATIENT_RULE_ID, relativeDeathQuote } from "@/lib/pipeline/death";
import { runPipeline, messageText } from "@/lib/pipeline/run";
import { createMockClient } from "@/lib/pipeline/llm";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";
import testsetData from "@/data/testset.json";

type Cat = RuleHit["category"];
const messages = messagesData as unknown as PatientMessage[];
const patients = patientsData as unknown as Patient[];
const labels = testsetData as unknown as TestLabel[];

const describeHits = (hits: RuleHit[]) => hits.map((h) => `${h.ruleId}:"${h.phrase}"`).join(", ") || "no hit";

function expectRoute(text: string, want: "urgent" | "clinician", firstName?: string) {
  const r = checkRules(text, { firstName });
  expect(routeForHits(r.hits)?.route, `"${text}" got ${describeHits(r.hits)}`).toBe(want);
}
function expectCategory(text: string, category: Cat, firstName?: string) {
  const r = checkRules(text, { firstName });
  expect(r.hits.some((h) => h.category === category), `"${text}" should hit ${category}, got ${describeHits(r.hits)}`).toBe(true);
}
function expectRoutine(text: string, firstName?: string) {
  const r = checkRules(text, { firstName });
  expect(r.matched, `"${text}" should stay routine, got ${describeHits(r.hits)}`).toBe(false);
}
function expectNotCategory(text: string, category: Cat) {
  const r = checkRules(text);
  expect(r.hits.some((h) => h.category === category), `"${text}" should not hit ${category}, got ${describeHits(r.hits)}`).toBe(false);
}

describe("family: euphemisms and slang for suicide", () => {
  for (const text of [
    "been thinkin a fair bit about how id check out and it doesnt even scare me anymore",
    "I keep thinking about checking out for good.",
    "By the time it's approved I'll probably have found a more permanent fix for all of this.",
    "Honestly the thought of dying doesn't scare me anymore.",
    "I'm not even scared of dying anymore.",
    "Leaving this world soon. Cancel it all.",
    "I'm ready to leave this world.",
    "I have been researching how many capsules it would take.",
    "I looked up how much oil it would take.",
  ]) {
    it(`crisis: ${text}`, () => {
      expectCategory(text, "crisis");
      expectRoute(text, "urgent");
    });
  }
  for (const text of [
    "How do I check out on the website?",
    "I've been thinking about checking out the new strain.",
    "Can you tell me how I'd check out with a promo code?",
    "Is there a permanent fix for the leaking lid?",
    "I need a permanent solution for my pain.",
    "The thought of the consult doesn't scare me anymore.",
    "How much would it take to get express shipping?",
    "I worked out how much it would take to cover the shortfall.",
  ]) {
    it(`not crisis: ${text}`, () => expectNotCategory(text, "crisis"));
  }
});

describe("family: hopelessness, no future, a wish for it to stop", () => {
  for (const text of [
    "There's no future for me, cancel the subscription.",
    "I'm so done. I can't see a future for me. Please just pause the orders.",
    "I don't have a future. Just stop the orders.",
    "Everyone would be happier without me.",
    "I keep thinking everyone would be happier if I was gone.",
    "My kids will be better without me around.",
    "I'm done fighting. I'm so tired of all of it.",
    "Please just let me be. I'm tired. I'm done fighting.",
    "I just want the pain to stop, forever.",
    "I feel like I'm drowning and I want it to stop.",
    "I'm scared I'll do something to myself.",
    "If I have my way I won't wake up tomorrow.",
    "I'm not planning to wake up tomorrow.",
  ]) {
    it(`crisis: ${text}`, () => expectRoute(text, "urgent"));
  }
  for (const text of [
    "I can't see a future with your company if this keeps happening.",
    "No future orders please, I'm switching providers.",
    "I'm done fighting with your billing team, just refund me.",
    "I'm sick of all this waiting around for the courier.",
    "My partner will be fine without me for the weekend.",
    "I'm a heavy sleeper so I won't wake up when the courier knocks.",
    "I'm scared I'll do something wrong with the website.",
  ]) {
    it(`not crisis: ${text}`, () => expectNotCategory(text, "crisis"));
  }
});

describe("family: goodbye and affairs-in-order signals", () => {
  for (const text of [
    "I've written my will and said my goodbyes. Please cancel my plan.",
    "I've said my goodbyes to the people who matter. Can you cancel everything after this order.",
    "You won't hear from me again after today. Thanks for all your help.",
    "Thanks for everything over the years. Please tell Dr Rao I'm grateful. You won't hear from me again.",
    "Please cancel my plan. I've made my peace with everything and I won't be needing anything from anyone soon.",
  ]) {
    it(`crisis: ${text}`, () => {
      expectCategory(text, "crisis");
      expectRoute(text, "urgent");
    });
  }
  it("a quiet farewell with no risk words (MSG-0978's signs together) is crisis", () => {
    const text =
      "Please cancel everything for me from here. I wanted to say thanks while I'm at it. You lot have been good to me, better than I've been to most people. My wife has the login and she'll sort out anything else after.\n\nLook after yourselves.";
    const hit = checkRules(text).hits.find((h) => h.ruleId === "crisis.quiet_farewell");
    expect(hit?.category).toBe("crisis");
    expectRoute(text, "urgent");
  });
  it("two strong-and-soft signs are enough: self-blame next to thanks", () => {
    expectRoute("Thank you for everything. I'm sorry for everything, I never deserved your help.", "urgent");
  });
  for (const text of [
    "You won't hear from me again until the next order is due.",
    "I've made my peace with the price rise.",
    "I won't be needing anything else, thanks!",
    "Please cancel everything, I'm moving to Perth. Thanks for everything, you've all been great to me!",
    "My wife has the login and she'll sort out anything else after my trip.",
    "Thanks for everything, see you next month! Look after yourself.",
  ]) {
    it(`not crisis: ${text}`, () => expectNotCategory(text, "crisis"));
  }
});

describe("family: a stated plan", () => {
  for (const text of [
    "I have a plan for how I'm going to do it. The oil is part of it.",
    "I've got a plan and I'm going to go through with it this weekend.",
    "I'm going to do it tonight. I've made up my mind.",
  ]) {
    it(`crisis: ${text}`, () => expectRoute(text, "urgent"));
  }
  for (const text of [
    "I have a plan for how to pay the overdue bill.",
    "I've got a plan for how to go about switching.",
    "I'll do it tomorrow, I've decided to update my card.",
    "It's time to renew, I'll do it tonight.",
  ]) {
    it(`not crisis: ${text}`, () => expectNotCategory(text, "crisis"));
  }
});

describe("family: stockpiling or keeping back doses", () => {
  for (const text of [
    "I've been putting a few capsules away each week so I have enough when the time comes.",
    "I've been saving my capsules so I have enough for when I'm ready.",
    "I've been putting some aside every week.",
    "I've been stashing my capsules in a drawer for weeks.",
    "I've got a bag of pills saved up and I know what I'm going to do with them.",
    "I've got all my capsules in a jar by the bed, it's more than enough.",
    "I'm saving up the leftover capsules in a drawer.",
  ]) {
    it(`crisis: ${text}`, () => expectRoute(text, "urgent"));
  }
  for (const text of [
    "I put the capsules away in the cupboard.",
    "I keep my capsules up high away from the kids.",
    "I'm keeping the capsules back in the fridge.",
    "I've been saving up for the next order.",
    "I'm saving my money for the next order.",
    "I want enough for when the time comes to travel.",
    "I've put aside the damaged bottle for the courier to collect.",
  ]) {
    it(`not crisis: ${text}`, () => expectNotCategory(text, "crisis"));
  }
});

describe("family: death reports in plain, formal or carer's words", () => {
  for (const text of [
    "Kia ora, this is Aroha's daughter. Mum took her last breath on Tuesday night. Please stop everything.",
    "Dad took his last breath on Sunday. Please stop the deliveries.",
    "We buried my husband last week, please stop his plan.",
    "We buried Mum yesterday, please cancel her account.",
    "We laid Dad to rest on Friday. Please close his account.",
    "We laid Mum to rest at the marae on Saturday.",
    "My mother departed this life on the 3rd. Please cancel.",
    "My wife has sadly departed this life. Please cancel her plan.",
    "Mum's gone. Please stop the orders.",
  ]) {
    it(`bereavement: ${text}`, () => {
      expectCategory(text, "bereavement");
      expectRoute(text, "urgent");
    });
  }
  it("a carer naming the patient by first name is a death report", () => {
    for (const text of ["Priya's gone. Stop the plan please.", "Priya is gone. Please don't send any more."]) {
      const hit = checkRules(text, { firstName: "Priya" }).hits.find((h) => h.ruleId === "bereavement.patient_gone");
      expect(hit, text).toBeDefined();
      expectRoute(text, "urgent", "Priya");
    }
  });
  for (const text of [
    "Mum's gone to the shops, can the driver wait?",
    "Dad's gone quiet about the order.",
    "Priya's gone overseas for a month, please hold the parcel.",
    "We finally laid the matter to rest with the bank.",
    "My flight departed late.",
    "My husband has departed for Sydney for work.",
    "The tracking says my parcel is dead in the water at the depot, where is it?",
    "My phone is dead so please email me.",
  ]) {
    it(`routine: ${text}`, () => expectRoutine(text, "Priya"));
  }
  it("found dead still escalates whatever comes before it", () => expectRoute("The driver said he was found dead in the water.", "urgent"));
  it("a sign-off about the patient is not the patient signing", () => {
    expect(relativeDeathQuote("My mum passed away on Sunday.\n\nLove,\nMele's daughter", "Mele")).toBeNull();
    expect(relativeDeathQuote("My dad passed away last month.\n\nThanks,\nMele", "Mele")).toBe("My dad passed away");
  });
  it("a relative's funeral signed by the patient reads as grief, not a serious reaction (MSG-0923)", () => {
    const text = "My uncle Hēmi's tangi is up at our marae. My capsules are meant to arrive at home tomorrow.\n\nNgā mihi,\nNikau";
    const hits = checkRules(text, { firstName: "Nikau" }).hits;
    expect(hits.some((h) => h.ruleId === RELATIVE_DEATH_RULE_ID)).toBe(true);
    expect(hits.some((h) => h.ruleId === LIVING_PATIENT_RULE_ID)).toBe(false);
    expect(routeForHits(hits)?.route).toBe("urgent");
  });
  it("overuse in the first person still leads over a relative's death", () => {
    const text = "My brother died three weeks ago. I've been taking more of my oil than I'm meant to.\n\nThanks,\nCharlotte";
    const hits = checkRules(text, { firstName: "Charlotte" }).hits;
    expect(hits.some((h) => h.ruleId === LIVING_PATIENT_RULE_ID)).toBe(true);
  });
});

describe("family: overuse and running out early", () => {
  for (const text of [
    "I'm using about four times the amount on the label now.",
    "I'm on three times what Dr Rao prescribed now, can you send extra?",
    "I've been taking four times the dose on the label.",
    "I've gone through the 30 day bottle in 12 days. Can you send the next one early?",
    "I've used up the whole month's supply in 10 days. Please send more.",
    "I've been topping up during the day on top of my prescribed dose.",
    "I accidentally took a whole dropper instead of 0.5 mL and now I feel really strange.",
  ]) {
    it(`adverse event: ${text}`, () => {
      expectCategory(text, "adverse_event");
      expectRoute(text, "urgent");
    });
  }
  for (const text of [
    "I take it three times a day as prescribed.",
    "It costs three times the price it used to.",
    "I've gone through the 30 day bottle in 30 days, right on time.",
    "I finished my month's supply in four weeks.",
    "I accidentally had the wrong address on file.",
    "I accidentally ordered two bottles.",
    "I've been topping up my Opal card.",
  ]) {
    it(`not an adverse event: ${text}`, () => expectNotCategory(text, "adverse_event"));
  }
});

describe("family: serious reactions in lay words", () => {
  for (const text of [
    "My chest has been really tight and painful since starting the capsules.",
    "My chest has been tight since the new oil.",
    "Pain in my chest since yesterday's dose.",
    "My face went numb on one side after the spray.",
    "One side of my face feels numb since last night.",
    "My throat feels like it's closing up since the spray.",
    "My lips went numb and my throat felt like it was closing after the spray.",
  ]) {
    it(`adverse event: ${text}`, () => {
      expectCategory(text, "adverse_event");
      expectRoute(text, "urgent");
    });
  }
  for (const text of ["My chest has been pounding every night since the new capsules.", "My heart has been thumping like mad since I started the flower."]) {
    it(`side effect for a clinician: ${text}`, () => {
      expectCategory(text, "side_effect");
      expectRoute(text, "clinician");
    });
  }
  for (const text of ["My throat is sore, is the pharmacy closing early today?", "My heart is set on the new strain.", "One side of the box was crushed."]) {
    it(`not an adverse event: ${text}`, () => expectNotCategory(text, "adverse_event"));
  }
});

describe("family: a change of dose or frequency", () => {
  for (const text of ["Can I increase to two capsules at night?", "Can I increase to two capsules?", "Can I start taking the capsules twice a day?", "Could I drop to one spray at night?"]) {
    it(`clinician: ${text}`, () => {
      expectCategory(text, "clinical_question");
      expectRoute(text, "clinician");
    });
  }
  for (const text of ["Can I have the parcel once a week?", "Can I get deliveries twice a day?", "My order has up to 3 capsules per pack?"]) {
    it(`routine: ${text}`, () => expectNotCategory(text, "clinical_question"));
  }
});

describe("false alarms fixed without losing a catch", () => {
  it("keen and impatient idioms stay routine (MSG-0158, MSG-0167)", () => {
    expectRoutine("hey legends, dying to get my order haha. any idea when ORD-20025 ships?");
    expectRoutine("mate this delay is killing me. still nothin today and the tracking hasnt moved since the 15th.");
    expectRoutine("I'm dying for an update on my parcel.");
    expectRoutine("The wait is literally killing me haha");
  });
  it("the idioms still escalate when they are not plainly keen or impatient", () => {
    for (const text of ["I'm dying", "I feel like I'm dying", "I'm dying to be free of all this", "It's killing me", "The pain is killing me", "you're killing me"]) {
      expectRoute(text, "urgent");
    }
  });
  it("a street named after a hospital is an address (not an ambulance call)", () => {
    expectRoutine("Can I change my delivery address to 5 Hospital Road, Newtown?");
    expectRoutine("Please send it to 12 Old Hospital Hill Road.");
    expectRoute("I was taken to hospital. Road trip cancelled.", "urgent");
    expectRoute("They took me to Hospital St Vincent's last night.", "urgent");
  });
});

// ---------------- the red-team messages, end to end ----------------

const byId = (id: string) => messages.find((m) => m.id === id)!;
const patientOf = (m: PatientMessage) => patients.find((p) => p.id === m.patientId)!;
const run = (id: string) => {
  const m = byId(id);
  return runPipeline(m, patientOf(m), { llm: createMockClient(), mode: "live" });
};

describe("pipeline: the round-two misses are caught by the rules, before any AI", () => {
  for (const id of ["MSG-0973", "MSG-0978", "MSG-0983"]) {
    it(`${id}: urgent crisis, orders on hold, stopped at the rules, no draft`, async () => {
      const r = await run(id);
      expect(r.route).toBe("urgent");
      expect(r.holdOrders).toBe(true);
      expect(r.draft).toBeUndefined();
      expect(r.trail.find((s) => s.id === "rules")?.status).toBe("stopped");
      expect(r.rules.hits.some((h) => h.category === "crisis" && h.start >= 0)).toBe(true);
    });
  }
  it("MSG-0158 and MSG-0167 no longer stop at the rules", async () => {
    for (const id of ["MSG-0158", "MSG-0167"]) {
      const r = await run(id);
      expect(r.rules.hits.filter((h) => h.start >= 0 && h.category !== "stop_sending"), id).toEqual([]);
    }
  });
});

describe("corpus: the new families raise no alarm on any routine message", () => {
  const NEW_RULES = new Set([
    "crisis.farewell_words",
    "crisis.no_future",
    "crisis.plan",
    "crisis.plan_decided",
    "crisis.euphemism",
    "crisis.lethal_amount",
    "crisis.enough_when",
    "crisis.quiet_farewell",
    "bereavement.patient_gone",
  ]);
  const routine = labels.filter((l) => l.expectedRoute !== "urgent" && l.expectedRoute !== "clinician");
  it("covers a real routine corpus", () => expect(routine.length).toBeGreaterThan(50));
  it("no new-family hit in a routine message or its earlier patient messages", () => {
    const found: string[] = [];
    for (const l of routine) {
      const m = byId(l.messageId);
      if (!m) continue;
      const first = patientOf(m)?.firstName;
      const texts = [messageText(m), ...(m.thread ?? []).filter((e) => e.from === "patient").map((e) => e.body)];
      for (const t of texts) {
        for (const h of checkRules(t, { firstName: first }).hits) if (NEW_RULES.has(h.ruleId)) found.push(`${m.id} ${h.ruleId}:"${h.phrase}"`);
      }
    }
    expect(found).toEqual([]);
  });
  it("no crisis, bereavement or adverse hit at all on a routine message except the accepted relative deaths", () => {
    const accepted = new Set(["MSG-0120", "MSG-0923", "MSG-0945"]);
    const found: string[] = [];
    for (const l of routine) {
      const m = byId(l.messageId);
      if (!m || accepted.has(m.id)) continue;
      const hits = checkRules(messageText(m), { firstName: patientOf(m)?.firstName }).hits;
      for (const h of hits) if (h.category === "crisis" || h.category === "bereavement" || h.category === "adverse_event") found.push(`${m.id} ${h.ruleId}`);
    }
    expect(found).toEqual([]);
  });
});
