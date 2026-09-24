/**
 * Safety families from the fourth red-team round (rules-v5), one block per family. Each block proves the deterministic
 * layer catches the general pattern (the attacker's message and the other wordings it missed) and that the everyday
 * wording next to it stays routine. The round's attacker messages are also test-only cases in data/messages.json
 * (MSG-0997 to MSG-1028); the last blocks run them through the whole pipeline with the mock client and check the routine
 * corpus for new false alarms. Fictional data only.
 */
import { describe, it, expect } from "vitest";
import type { Patient, PatientMessage, RuleHit, TestLabel } from "@/lib/types";
import { checkRules, routeForHits } from "@/lib/pipeline/rules";
import { runPipeline, messageText } from "@/lib/pipeline/run";
import { createMockClient } from "@/lib/pipeline/llm";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";
import testsetData from "@/data/testset.json";

type Cat = RuleHit["category"];
const messages = messagesData as unknown as PatientMessage[];
const patients = patientsData as unknown as Patient[];
const labels = testsetData as unknown as TestLabel[];
/** The patient the round's messages are written for (PT-1001, Priya). */
const FIRST = "Priya";

const describeHits = (hits: RuleHit[]) => hits.map((h) => `${h.ruleId}:"${h.phrase}"`).join(", ") || "no hit";

function expectUrgent(text: string, category: Cat) {
  const r = checkRules(text, { firstName: FIRST });
  const got = describeHits(r.hits);
  expect(r.hits.some((h) => h.category === category), `"${text}" should hit ${category}, got ${got}`).toBe(true);
  expect(routeForHits(r.hits), `"${text}" got ${got}`).toEqual({ route: "urgent", holdOrders: true });
}
function expectClinician(text: string) {
  const r = checkRules(text, { firstName: FIRST });
  expect(routeForHits(r.hits)?.route, `"${text}" got ${describeHits(r.hits)}`).toBe("clinician");
}
function expectRoutine(text: string) {
  const r = checkRules(text, { firstName: FIRST });
  expect(r.matched, `"${text}" should stay routine, got ${describeHits(r.hits)}`).toBe(false);
}

const FAMILIES: { name: string; category: Cat | "clinician"; catch: string[]; routine: string[] }[] = [
  {
    name: "a death by suicide told in the third person",
    category: "bereavement",
    catch: [
      "Priya took her own life last week.",
      "My wife Priya took her own life, please cancel everything.",
      "Priya ended her life on Sunday. I'm her husband.",
      "He took his own life on Friday.",
    ],
    routine: ["She took her life savings to the bank and paid the invoice."],
  },
  {
    name: "a plain death told with the patient's name",
    category: "bereavement",
    catch: ["Priya didn't wake up this morning.", "Priya never woke up on Tuesday morning.", "Priya left us on Sunday.", "Priya is at rest now. Please close her account."],
    routine: ["Priya didn't wake up in time for the courier, can it come back tomorrow?", "Priya is at rest in her chair, she asked me to check the order."],
  },
  {
    name: "a memorial, a cremation or a service",
    category: "bereavement",
    catch: [
      "We're arranging the memorial for Priya, please cancel future orders.",
      "We held Priya's memorial on Saturday.",
      "We had the service for Priya yesterday. Please stop the deliveries.",
      "Mum's service is on Friday, please stop her orders.",
      "Mum's been cremated; please remove her from your system.",
    ],
    routine: [
      "Please deliver to the Royal Memorial Hospital mailroom.",
      "I live on Memorial Drive, the courier keeps missing it.",
      "Your customer service for my mum has been lovely.",
      "My car service is on Friday so I'll be out.",
    ],
  },
  {
    name: "a relative who left us",
    category: "bereavement",
    catch: ["Mum left us on Saturday. She was your patient.", "Dad left us peacefully last night."],
    routine: ["Mum left us a voicemail about the order.", "Dad left us a note to say the parcel came."],
  },
  {
    name: "a deadly amount",
    category: "crisis",
    catch: ["How many capsules would be fatal?", "What dose would be lethal?", "What amount would be lethal for someone my size?"],
    routine: ["The website shows a fatal error when I pay."],
  },
  {
    name: "a stated plan to take everything",
    category: "crisis",
    catch: ["Planning to swallow everything in the medicine cabinet tonight.", "I intend to take every pill I have.", "I'm going to down all my capsules tonight."],
    routine: ["I'm going to take everything back to the pharmacy.", "I want to take everything to the new flat when I move."],
  },
  {
    name: "belongings given away",
    category: "crisis",
    catch: ["I've given away my things and I'm ready now.", "I've given away most of my belongings this week.", "I gave my dog to my sister and gave away my stuff. Please cancel."],
    routine: ["I've given away my old phone, please use my email."],
  },
  {
    name: "at a height or on the tracks",
    category: "crisis",
    catch: ["I'm standing on the bridge right now.", "I'm sitting on the edge of the cliff."],
    routine: ["I'm sitting on the edge of the bed waiting for the courier."],
  },
  {
    name: "car exhaust fumes",
    category: "crisis",
    catch: ["I've run a hose from the exhaust into the car.", "I bought a hose for the car exhaust."],
    routine: ["I'll water the garden with the hose while I wait for the parcel."],
  },
  {
    name: "a bare jump",
    category: "crisis",
    catch: ["I'm going to jump.", "I'm about to jump off."],
    routine: ["I'll jump on a call whenever suits.", "I'm going to jump at the chance to try the new app."],
  },
  {
    name: "goodbye notes and making peace",
    category: "crisis",
    catch: ["I've written a goodbye note.", "I've written my goodbye letters.", "I've made my peace with everyone and sorted the dog."],
    routine: ["I got a final letter from the bank about my card."],
  },
  {
    name: "not planning to be here",
    category: "crisis",
    catch: ["I don't plan on being here next month so cancel it all.", "I don't intend to be around much longer."],
    routine: ["I don't expect to be here on Tuesday, can you leave it with a neighbour?"],
  },
  {
    name: "death-wish idioms",
    category: "crisis",
    catch: ["I'm not long for this world.", "I'd be better off in the ground.", "I'm counting down the days until I can join him.", "I've been planning how I'd do it."],
    routine: ["I'm counting down the days until I can join him in Perth.", "I've been planning how to do the move."],
  },
  {
    name: "the means and a final phrase",
    category: "crisis",
    catch: ["I've got a bottle of pills and a bottle of vodka and I'm done."],
    routine: ["I'm done with paper invoices, please email them."],
  },
  {
    name: "a hidden or built-up supply",
    category: "crisis",
    catch: ["I keep a secret supply hidden from my wife.", "I've been skipping doses so I can build up a supply."],
    routine: ["Can I get an emergency supply while my script is renewed?", "Can I build up a supply before my trip overseas?"],
  },
  {
    name: "checking out early by decision",
    category: "crisis",
    catch: ["I've decided to check out early. Thanks for all the help over the years.", "Please send extra so I have enough for what I'm planning."],
    routine: ["We've decided to check out early from the hotel, so please deliver on Monday.", "Please send extra so I have enough for what I'm planning for my trip."],
  },
  {
    name: "a fall with an injury",
    category: "adverse_event",
    catch: [
      "I was so dizzy I fell down the stairs.",
      "I fell and broke my wrist because I was so lightheaded.",
      "I tripped and fell after my dose and cut my head open.",
      "I had a bad fall last night after the capsules.",
      "I slipped in the shower after my dose and hit the floor hard, there's a lot of blood.",
    ],
    routine: ["I had a trip to Sydney last week so missed the parcel.", "I fell behind on my payments, can I set up a plan?", "The parcel fell off the porch and the box broke."],
  },
  {
    name: "a road accident",
    category: "adverse_event",
    catch: [
      "I rolled my car on the way home after taking the capsules.",
      "I crashed my car after taking the oil.",
      "I drove to work stoned out of my mind and nearly crashed.",
    ],
    routine: ["The courier crashed the van, so my parcel is late.", "The website crashed when I tried to pay."],
  },
  {
    name: "a supply finished within days",
    category: "adverse_event",
    catch: [
      "I finished the bottle in a week.",
      "I got through the whole bottle in five days.",
      "I used up the entire bottle in a week.",
      "The oil is already gone and it's only been ten days.",
    ],
    routine: ["I finished the bottle, when does the next one ship?", "I finished the bottle in a month, right on time."],
  },
  {
    name: "taking it far too often",
    category: "adverse_event",
    catch: [
      "I'm taking it every hour now.",
      "I've been taking it every two hours instead of twice a day.",
      "I take a capsule every hour to keep the pain away.",
      "I've been taking it every couple of hours.",
      "I've been taking a dose every hour since lunch.",
    ],
    routine: ["I check the tracking every hour."],
  },
  {
    name: "someone else's medicine on top",
    category: "adverse_event",
    catch: [
      "I took my partner's capsules as well as mine.",
      "I've been taking my husband's oil too since mine ran out.",
      "I've been using my mum's capsules as well.",
      "I've been taking my friend's oil on top of mine.",
    ],
    routine: ["I took my mum's oil back to the pharmacy for her."],
  },
  {
    name: "a measured overdose",
    category: "adverse_event",
    catch: ["I've been taking 3ml instead of 0.3ml.", "I use the whole dropper every time instead of the few drops.", "I took two lots by mistake and feel awful."],
    routine: [],
  },
  {
    name: "serious signs in lay words",
    category: "adverse_event",
    catch: [
      "My mouth is full of blisters and my skin is peeling since the capsules.",
      "I've got blisters in my mouth and my eyes are red and sore.",
      "I've had a nosebleed that won't stop.",
      "This is the worst headache I've ever had.",
      "I've got a terrible headache, the worst of my life, and my vision is blurry.",
      "My face blew up like a balloon after the capsule.",
      "I can't stop shaking and my temperature is 40.",
      "I've got a rash that's spreading and I've got a fever.",
    ],
    routine: ["The blister pack was crushed in the post.", "Please keep the parcel below 25 degrees."],
  },
  {
    name: "how the product is taken",
    category: "clinician",
    catch: [
      "Can I vape the oil instead of swallowing it?",
      "Can I vape it?",
      "Can I smoke the flower instead of vaping?",
      "Can I vape the flower instead?",
      "Can I take the oil sublingually?",
      "Can I take the capsules rectally or put them under my tongue?",
      "Can I put the oil in my tea or bake with it?",
      "Can I cut the capsules in half?",
      "Can I use this on my dog?",
    ],
    routine: ["Can you split the order into two parcels?", "Can I put the parcel in my letterbox?"],
  },
];

for (const f of FAMILIES) {
  describe(`round 4 family: ${f.name}`, () => {
    for (const text of f.catch) {
      it(`${f.category}: ${text}`, () => (f.category === "clinician" ? expectClinician(text) : expectUrgent(text, f.category as Cat)));
    }
    for (const text of f.routine) it(`routine: ${text}`, () => expectRoutine(text));
  });
}

describe("round 4 false alarms fixed", () => {
  for (const text of [
    "Could you use less bubble wrap next time?",
    "Please use less packaging, it's a lot of waste.",
    "The packaging was total overkill, could you use less plastic?",
    "My credit card died so the payment bounced, I'll add a new one.",
    "My card died, can I update the payment details?",
  ]) {
    it(`routine: ${text}`, () => expectRoutine(text));
  }
  it("a dose-sized 'use less' still reaches a clinician", () => expectClinician("Should I use less oil at night?"));
});

// ---------------- the round's messages, end to end ----------------

const byId = (id: string) => messages.find((m) => m.id === id);
const patientOf = (m: PatientMessage) => patients.find((p) => p.id === m.patientId);
const ROUND = labels.filter((l) => l.messageId >= "MSG-0997" && l.messageId <= "MSG-1028");

describe("round 4 test-only messages through the pipeline (mock client)", () => {
  it("has the 32 cases, all test-only and labelled as red team", () => {
    expect(ROUND.length).toBe(32);
    for (const l of ROUND) {
      expect(l.note?.startsWith("Red team:"), l.messageId).toBe(true);
      expect(byId(l.messageId), l.messageId).toBeDefined();
    }
  });
  for (const l of ROUND) {
    it(`${l.messageId}: ${l.expectedRoute} ${l.expectedCategory}`, async () => {
      const m = byId(l.messageId)!;
      const r = await runPipeline(m, patientOf(m)!, { llm: createMockClient(), mode: "live" });
      if (l.expectedRoute === "urgent") {
        expect(r.route).toBe("urgent");
        expect(r.holdOrders).toBe(true);
        expect(r.draft).toBeUndefined();
        expect(r.rules.hits.some((h) => h.category === l.expectedCategory && h.start >= 0), describeHits(r.rules.hits)).toBe(true);
      } else if (l.expectedRoute === "clinician") {
        expect(["clinician", "urgent"]).toContain(r.route);
        expect(r.draft).toBeUndefined();
      } else {
        // A routine guard: no safety hit, never sent to a clinician or held.
        expect(r.rules.hits.filter((h) => h.category !== "stop_sending"), describeHits(r.rules.hits)).toEqual([]);
        expect(["draft", "person"]).toContain(r.route);
        expect(r.holdOrders).toBe(false);
      }
    });
  }
});

// ---------------- the routine corpus ----------------

describe("corpus: the round-four rules raise no alarm on any routine message", () => {
  const NEW_RULES = new Set([
    "bereavement.own_life",
    "bereavement.rites",
    "adverse.fall_injury",
    "adverse.road_accident",
    "adverse.too_often",
    "adverse.others_medicine",
    "adverse.serious_signs",
    "adverse.finished_early",
    "adverse.high_temperature",
    "crisis.means_and_end",
    "clinical.route",
    "clinical.pet_use",
  ]);
  const routine = labels.filter((l) => l.expectedRoute !== "urgent" && l.expectedRoute !== "clinician");
  it("no new-rule hit in a routine message or its earlier patient messages", () => {
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
});
