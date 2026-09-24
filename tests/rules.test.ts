import { describe, it, expect } from "vitest";
import {
  RULES_VERSION,
  RULE_CATEGORY_LABELS,
  checkRules,
  hasStopSending,
  primarySafetyCategory,
  routeForHits,
  ruleCounts,
} from "@/lib/pipeline/rules";
import { LIVING_PATIENT_RULE_ID, RELATIVE_DEATH_RULE_ID, isLivingPatientReport, reportsPatientDeath } from "@/lib/pipeline/death";
import type { RuleHit } from "@/lib/types";

type Cat = RuleHit["category"];

const cats = (text: string): Set<Cat> => new Set(checkRules(text).hits.map((h) => h.category));
const route = (text: string) => routeForHits(checkRules(text).hits);

function expectCategory(text: string, category: Cat) {
  const found = cats(text);
  expect(found.has(category), `expected "${text}" to hit ${category}, got [${[...found].join(", ")}]`).toBe(true);
}
function expectRoutine(text: string) {
  const r = checkRules(text);
  expect(r.matched, `expected "${text}" to stay routine, got ${r.hits.map((h) => `${h.ruleId}:"${h.phrase}"`).join(", ")}`).toBe(false);
}

describe("rules: version and shape", () => {
  it("exposes the rules version", () => {
    expect(RULES_VERSION).toBe("rules-v7");
  });

  it("returns hits with the matched phrase and indices into the original text", () => {
    const text = "Hi team, I feel dizzy since the new bottle.";
    const { matched, hits } = checkRules(text);
    expect(matched).toBe(true);
    const dizzy = hits.find((h) => h.category === "side_effect" && /dizzy/i.test(h.phrase));
    expect(dizzy).toBeDefined();
    expect(text.slice(dizzy!.start, dizzy!.end)).toBe(dizzy!.phrase);
    expect(dizzy!.ruleId).toMatch(/^side_effect\./);
  });

  it("returns hits sorted by position, with phrases from the original casing", () => {
    const { hits } = checkRules("Went to HOSPITAL after I had a Seizure");
    expect(hits.map((h) => h.phrase)).toEqual(["HOSPITAL", "Seizure"]);
    expect(hits[0].start).toBeLessThan(hits[1].start);
  });

  it("handles empty text", () => {
    expect(checkRules("")).toEqual({ matched: false, hits: [] });
  });

  it("has rules for every category and a label for each", () => {
    const counts = ruleCounts();
    for (const c of Object.keys(RULE_CATEGORY_LABELS) as Cat[]) expect(counts[c]).toBeGreaterThan(0);
  });
});

describe("rules: crisis", () => {
  const cases = [
    "I've been thinking about suicide",
    "honestly feeling suicidal tonight",
    "I want to kill myself",
    "I'm going to end it all",
    "I just want to end my life",
    "I've been self-harming again",
    "I keep wanting to hurt myself",
    "I don't want to be here anymore",
    "I dont want to live like this",
    "there's no reason to live",
    "I have nothing to live for",
    "I can't go on like this",
    "I can’t cope any more",
    "I might overdose on purpose",
    "I'm going to take the whole bottle",
    "having really dark thoughts lately",
    "I want to die",
    "wish I was dead",
    "everyone would be better off without me",
    "I don't feel safe with myself",
    "I'm not coping at all",
    "I've started cutting again",
    "I hope I never wake up",
    "I'm done with life",
    "thinking about how to unalive myself",
    "I just want to go to sleep and not wake up",
    "I'm scared I might hurt someone",
    "my son has been hurting himself",
    "Honestly what's the point",
    "I won't be around much longer",
    "she feels everyone would be better off without her",
  ];
  for (const text of cases) {
    it(`escalates: ${text}`, () => {
      expectCategory(text, "crisis");
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }

  it("catches crisis language wrapped in sarcasm", () => {
    expectCategory("Oh wonderful, another delay. Really makes me want to kill myself.", "crisis");
    expectCategory("Great service, I'll just die waiting then", "crisis");
  });

  it("catches crisis language buried in a routine billing question", () => {
    const text = "Why was I charged $129 twice? Honestly I can't go on like this, everything is falling apart.";
    expectCategory(text, "crisis");
    expect(route(text)?.route).toBe("urgent");
  });
});

describe("rules: accepted false positives (we over-escalate on purpose)", () => {
  // A false alarm costs one minute of a person's time. These idioms escalate by design and are documented as such.
  const accepted: [string, Cat][] = [
    ["I'm dying, it's been two weeks", "crisis"],
    ["This is killing me", "crisis"],
    ["The pain is killing me", "crisis"],
    ["kill me now, the tracking link is broken again", "crisis"],
    ["My uncle died so I'll be away, please hold my next order", "bereavement"],
    ["My dad passed away last month, so please change my delivery address", "bereavement"],
    ["I'm anxious my order won't arrive before I travel", "side_effect"],
    ["no side effects at all, just need my renewal", "side_effect"],
    ["I had too much going on to reply earlier", "adverse_event"],
    ["the courier would have to take more time I guess", "clinical_question"],
  ];
  for (const [text, category] of accepted) {
    it(`escalates (accepted): ${text}`, () => {
      expectCategory(text, category);
      expect(route(text)).not.toBeNull();
    });
  }
});

describe("rules: a pet's death is not a bereavement", () => {
  const pets = [
    "my dog passed away last week, can I pause my plan?",
    "Our dog Bonnie died on the weekend. Could you please pause my plan?",
    "our cat has sadly died, I'm away for a bit",
    "My kitten Mochi passed away yesterday",
  ];
  for (const text of pets) {
    it(`no bereavement hit: ${text}`, () => {
      expect(cats(text).has("bereavement")).toBe(false);
    });
  }

  it("still escalates a person's death, including next to a pet", () => {
    for (const text of ["my mum died", "My dad passed away last month", "our dog walker's husband died", "the dog is fine but my wife died"]) {
      expectCategory(text, "bereavement");
    }
  });
});

describe("rules: more ways of reporting a death", () => {
  const cases = [
    "Sadly my husband is no longer here",
    "My koro passed last week",
    "we lost Mum on Sunday",
    "he is in heaven now",
    "I'm handling her estate",
    "rip mum, she loved your team",
    "My grandad passed on Friday",
  ];
  for (const text of cases) {
    it(`bereavement: ${text}`, () => {
      expectCategory(text, "bereavement");
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }

  it("does not fire on moving house", () => {
    expect(cats("I'm no longer living at this address, please update it").has("bereavement")).toBe(false);
    expect(cats("we lost Mum's parcel somewhere").has("bereavement")).toBe(false);
  });
});

describe("rules: bereavement", () => {
  const cases = [
    "My husband passed away on Sunday",
    "I'm writing to let you know Mum passed last week",
    "Dad has sadly passed",
    "my wife died on the 14th",
    "he has died",
    "I'm the executor of his estate",
    "the funeral is on Friday",
    "She is deceased",
    "we lost my father last month",
    "my late husband's account",
    "she's no longer with us",
    "Mum passed on peacefully",
    "RIP Dad",
    "since her passing we have been sorting her things",
    "he was killed in a car accident",
    "she lost her battle with cancer",
    "She went peacefully on Monday",
    "Mum won't be needing her orders any more",
  ];
  for (const text of cases) {
    it(`escalates: ${text}`, () => {
      expectCategory(text, "bereavement");
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }

  it("catches a carer reporting a death and asking to stop orders", () => {
    const text = "Hi, I'm Tom, Margaret's son. Mum passed away on Monday. Please stop sending her orders.";
    const found = cats(text);
    expect(found.has("bereavement")).toBe(true);
    expect(found.has("stop_sending")).toBe(true);
    expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
  });

  it("does not read a dead phone or battery as a death", () => {
    expectRoutine("My phone is dead so please email me");
    expectRoutine("Missed my consult because my phone died, can I rebook?");
    expectRoutine("the battery has died on the scale");
  });

  it("does not read 'an overdose of emails' or 'expecting a parcel' as clinical", () => {
    expectRoutine("I'm getting an overdose of emails, take me off the list");
    expectRoutine("I'm expecting a parcel on Friday");
    expectRoutine("We're expecting it this week");
  });

  it("does not read 'passed on to', 'passed the' or 'rip off' as a death", () => {
    expectRoutine("Has my message been passed on to the pharmacy?");
    expectRoutine("It passed the depot yesterday");
    expectRoutine("The driver who passed by didn't knock");
    expectRoutine("What a rip off, the price went up again");
  });
});

describe("rules: adverse events", () => {
  const cases = [
    "I ended up in hospital last night",
    "we had to call an ambulance",
    "I was in the emergency department for hours",
    "Spent the night in ED",
    "went to A&E this morning",
    "we called 000",
    "she had a seizure after her dose",
    "he was having fits",
    "I started hallucinating",
    "I think I had a psychotic episode",
    "chest pain since this morning",
    "I can't breathe properly",
    "I fainted in the shower",
    "I passed out at work",
    "he collapsed in the kitchen",
    "I had an allergic reaction",
    "my lips are swelling",
    "swelling of my throat",
    "I was vomiting blood",
    "I think I took too much",
    "I accidentally double dosed",
    "my toddler swallowed some of the oil",
    "the dog ate two capsules",
    "severe pain in my stomach",
    "my daughter found my oil and drank some",
    "I took double last night by mistake",
    "I couldn't move my legs",
    "he was rushed to the clinic",
    "my 4-year-old got into my oil this morning",
    "our little one chewed the lid and swallowed some",
    "I think I overdid it last night",
    "Mum has moved into palliative care",
  ];
  for (const text of cases) {
    it(`escalates: ${text}`, () => {
      expectCategory(text, "adverse_event");
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }

  it("treats paranoia as an adverse event, as the handbook does", () => {
    expect(route("After my last dose I felt very paranoid and was hearing things")).toEqual({ route: "urgent", holdOrders: true });
  });

  it("does not match ED or ER inside ordinary lowercase words", () => {
    expectRoutine("I ordered it and it was delivered to the wrong door");
  });

  it("does not read 'a good fit' or a lid 'fitting properly' as a seizure", () => {
    expectRoutine("The new plan is not a fit for my budget");
    expectRoutine("The lid isn't fitting properly");
  });
});

describe("rules: side effects", () => {
  const cases = [
    "the new oil made me feel dizzy",
    "a bit of nausea after the last bottle",
    "I've been vomiting since Tuesday",
    "really drowsy in the mornings",
    "I get headaches now",
    "feeling anxious after taking it",
    "my heart was racing",
    "I had palpitations",
    "any side effects to expect?",
    "I felt weird afterwards",
    "I felt sick after the last one",
    "I couldn't sleep after my evening dose",
    "dry mouth all day",
    "I got a rash",
    "the oil isn't working anymore",
    "my pain is getting worse",
  ];
  for (const text of cases) {
    it(`escalates: ${text}`, () => {
      expectCategory(text, "side_effect");
      expect(route(text)?.route).toBe("clinician");
    });
  }

  it("routes a billing question that also mentions a side effect to a clinician (two intents)", () => {
    const text = "I was charged twice this month, can you refund one? Also the new oil made me feel dizzy.";
    expectCategory(text, "side_effect");
    expect(route(text)).toEqual({ route: "clinician", holdOrders: false });
  });

  it("does not escalate 'sick of waiting' or 'confused why I was charged'", () => {
    expectRoutine("I was sick of waiting so I called");
    expectRoutine("I'm confused why I was charged twice");
    expectRoutine("The app isn't working for me");
  });
});

describe("rules: clinical questions", () => {
  const cases = [
    "What dose should I start on?",
    "can I change my dosage?",
    "How much should I take before bed?",
    "how many drops is normal?",
    "Can I take it with my sertraline?",
    "is it ok to mix it with alcohol?",
    "I'm on antidepressants, is that a problem?",
    "does it interact with warfarin?",
    "I just found out I'm pregnant",
    "is it safe while breastfeeding?",
    "Can I drive after taking it?",
    "is it ok to drive the next morning?",
    "I have a roadside drug test for work",
    "can I have a glass of wine with it?",
    "am I allowed to operate machinery?",
    "Should I stop taking it before my surgery?",
    "I missed a dose yesterday",
    "I have epilepsy, is that ok?",
    "what's the THC in my oil?",
    "Can I get a stronger oil?",
    "I'm taking other medications too",
    "is it okay to take paracetamol too?",
    "can I give some to my partner?",
    "can I take my oral spray on the plane to Italy?",
    "just found out I'm expecting!! does that change anything",
  ];
  for (const text of cases) {
    it(`escalates: ${text}`, () => {
      expectCategory(text, "clinical_question");
      expect(route(text)?.route).toBe("clinician");
    });
  }

  it("routes a carer's clinical question about a relative to a clinician", () => {
    const text = "I look after my dad, he's the patient. Can he take the capsules with his blood thinners?";
    expectCategory(text, "clinical_question");
    expect(route(text)?.route).toBe("clinician");
  });

  it("does not treat a street called Drive, or driving to the post office, as a driving question", () => {
    expectRoutine("Can I get my order delivered to 14 Banksia Drive instead?");
    expectRoutine("I had to drive to the post office and it wasn't there");
  });

  it("does not treat billing or waiting questions as dosing questions", () => {
    expectRoutine("How much do I have to pay this month?");
    expectRoutine("How long do I have to wait for my order?");
    expectRoutine("Can I use my new treatment plan from next month?");
    expectRoutine("I want to stop my treatment plan");
  });
});

describe("rules: stop sending", () => {
  const cases = [
    "Please stop sending my orders",
    "don't send the next one",
    "Do not send anything else",
    "cancel my orders please",
    "cancel all my future orders",
    "no more deliveries thanks",
    "please put my orders on hold",
    "stop all future deliveries",
    "I don't want any more orders",
    "please stop the next delivery",
  ];
  for (const text of cases) {
    it(`flags: ${text}`, () => {
      const r = checkRules(text);
      expect(hasStopSending(r.hits)).toBe(true);
    });
  }

  it("does not stop the trail on its own, and routeForHits returns null", () => {
    const r = checkRules("Please stop sending my orders, I have plenty left.");
    expect(r.matched).toBe(false);
    expect(routeForHits(r.hits)).toBeNull();
    expect(hasStopSending(r.hits)).toBe(true);
  });

  it("does not treat a marketing opt-out as stop sending", () => {
    const r = checkRules("Please stop sending me marketing emails");
    expect(hasStopSending(r.hits)).toBe(false);
    expect(checkRules("don't send me any more texts").hits).toEqual([]);
  });

  it("sets a hold on a clinician route when the patient also asks to stop sending", () => {
    const hits = checkRules("I feel dizzy on it, please stop sending the oil").hits;
    expect(routeForHits(hits)).toEqual({ route: "clinician", holdOrders: true });
  });
});

// Red-team probes: phrasings a visitor might type into the live box. Each must reach the right queue.
describe("rules: red-team probes, crisis (urgent)", () => {
  const cases = [
    "i want to kil myself",
    "k*ll myself",
    "want to top myself",
    "i want to hang myself",
    "been thinking of slitting my wrists",
    "Everyone would be better off if I just disappeared",
    "I don't want to be a burden anymore",
    "no one would miss me",
    "it's not worth living anymore",
    "i dont see a way out",
    "what is the point of anything",
    "I have a plan for how to end my pain for good",
    "I'm saving them up for when I've had enough",
    "I've been giving my things away and writing letters to people",
    "I've started hurting again, the urges are back",
    "no reason to keep going",
    "i feel numb and hopeless",
  ];
  for (const text of cases) {
    it(`crisis: ${text}`, () => {
      expectCategory(text, "crisis");
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }
});

describe("rules: red-team probes, serious adverse events (urgent)", () => {
  const cases = [
    "I took the whole bottle",
    "I OD'd on it",
    "od'd on it last night",
    "i od'd on my oil",
    "i drank half the bottle",
    "I lost consciousness",
    "he won't wake up",
    "I can't rouse her",
    "she's not breathing properly",
    "my chest hurts",
    "my chest is really tight",
    "swollen lips and tongue",
    "my throat feels tight",
    "having a siezure",
    "her face is drooping",
    "he's slurring his words",
    "My 4yo got hold of the bottle and had some",
    "I keeled over and my partner called an ambo",
    "Dad fell over and hit his head",
    "she didn't know who I was and was talking nonsense",
    "my skin has gone yellow",
    "my heart is going crazy and my arm feels numb",
    "burning up with a fever and my throat feels tight",
  ];
  for (const text of cases) {
    it(`adverse event: ${text}`, () => {
      expectCategory(text, "adverse_event");
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }

  it("keeps everyday phrasings near the new crisis words routine", () => {
    expectRoutine("I'm saving up for a holiday so can I pause my plan?");
    expectRoutine("Would I be better off if I switched plans?");
    expectRoutine("I want out of this plan, please cancel it");
    expectRoutine("the courier is hopeless");
    expect(cats("my knee started hurting again").has("crisis")).toBe(false);
  });

  it("does not read 'odd' or 'a lot' as an overdose", () => {
    expectRoutine("That's odd, the tracking hasn't moved");
    expectRoutine("It will take a lot longer to arrive, I guess");
    expectRoutine("Can the courier take the box back?");
  });
});

describe("rules: red-team probes, side effects and clinical questions (clinician)", () => {
  const sideEffects = [
    "my mouth is really dry",
    "my eyes go red",
    "My back is way worse since I started",
    "she's been confused",
    "Dad fell over twice",
    "I can't stop crying and feel empty",
  ];
  for (const text of sideEffects) {
    it(`side effect: ${text}`, () => {
      expectCategory(text, "side_effect");
      expect(route(text)?.route).toBe("clinician");
    });
  }
  const clinical = [
    "should I increase to 1 mL",
    "can I up it by 2 drops?",
    "can I increase my oil at night?",
    "I'm up the duff, is that a problem?",
    "we have a bun in the oven",
    "estoy embarazada",
    "Puedo tomar el aceite con mi medicación",
    "is it still OK to use after a week in a hot car?",
    "can I still use it if it looks darker?",
  ];
  for (const text of clinical) {
    it(`clinical question: ${text}`, () => {
      expectCategory(text, "clinical_question");
      expect(route(text)?.route).toBe("clinician");
    });
  }
});

describe("rules: routing and priority", () => {
  it("urgent beats clinician when both are present", () => {
    const hits = checkRules("Can I take it with my sertraline? Last time I ended up in hospital.").hits;
    expect(routeForHits(hits)).toEqual({ route: "urgent", holdOrders: true });
    expect(primarySafetyCategory(hits)).toBe("adverse_event");
  });

  it("names crisis first, then bereavement, then adverse events", () => {
    expect(primarySafetyCategory(checkRules("Mum died in hospital").hits)).toBe("bereavement");
    expect(primarySafetyCategory(checkRules("I was in hospital and I want to die").hits)).toBe("crisis");
    expect(primarySafetyCategory(checkRules("feeling dizzy, can I take less?").hits)).toBe("side_effect");
    expect(primarySafetyCategory([])).toBeNull();
  });

  it("returns null for a routine message", () => {
    expect(route("Where is my order ORD-20481? It was meant to arrive Tuesday.")).toBeNull();
  });
});

describe("rules: routine messages stay routine", () => {
  const routine = [
    "Where is my order? The tracking hasn't updated since Monday.",
    "Hi, can I change my delivery address to my work?",
    "Why did my price go up this month?",
    "Can I pause my plan for a month? I'm travelling.",
    "I need to reschedule my consult on Friday",
    "I can't log in, the password reset email never came",
    "Can I get a receipt for my last payment?",
    "My script is running out, can I renew?",
    "The box arrived damaged but the bottle is fine",
    "I'd like to speak to a real person please",
    "Please delete my data and stop marketing emails",
    "How should I store the oil, fridge or cupboard?",
    "Your service is hopeless, it's been a week!",
    "My card was declined, can you try again?",
    "Is the concession price still available for pensioners?",
    "The parcel says delivered but it's not at my door",
    "Can you send it to my neighbour at number 12?",
    "I'm really unhappy with how long this has taken",
  ];
  for (const text of routine) {
    it(`routine: ${text}`, () => expectRoutine(text));
  }
});

// ---------------- round 2: lexicon gaps found by adversarial review ----------------

describe("rules: crisis language without the usual words (review round 2)", () => {
  const cases = [
    "it would be easier if I just wasn't here anymore",
    "Ive written letters to my kids and sorted my affairs. please cancel everything",
    "Everything feels pointless and I'm thinking of ending my own life",
    "just want it all to be over",
    "I don't see myself being here next year tbh",
    "I'm going to take the lot tonight",
    "Please cancel my plan. I won't need it where I'm going.",
    "i need it before i do something stupid",
    "i'm really struggling without it, having thoughts again",
    "can you cancel everything, ive decided im not going to be around after friday",
  ];
  for (const text of cases) {
    it(`crisis: ${text}`, () => {
      expectCategory(text, "crisis");
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }

  it("keeps delivery notes and plans near the new crisis words routine", () => {
    expectRoutine("I left a note for the courier on the door");
    expectRoutine("I've left a note for my neighbour to sign for it");
    expectRoutine("I'm not going to be here by the time it arrives, can you hold it at the depot?");
    expectRoutine("This process is pointless, just refund me");
  });
});

describe("rules: serious adverse events in everyday words (review round 2)", () => {
  const cases = [
    "my wife is in icu",
    "had to go to a&e after the last bottle",
    "ended up in the er last night",
    "im gonna be in hosp",
    "staying at the psych ward",
    "i was admitted on friday",
    "took way more than he should have and now hes not making any sense",
    "Mum's gone all floppy and grey and won't answer me properly",
    "gone blue around the lips and is barely breathing",
    "Woke up on the bathroom floor, no idea how I got there",
    "my fits have started coming back",
    "my son took some of my oil",
    "I took 3x my usual amount",
    "cant keep anything down, my pee is dark brown and my eyes look a bit yellow",
    "my hands wont stop trembling and i keep feeling like i might pass out",
  ];
  for (const text of cases) {
    it(`adverse event: ${text}`, () => {
      expectCategory(text, "adverse_event");
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }

  it("keeps hesitations, objects and service complaints routine", () => {
    expectRoutine("hi, I wanted to er check my order");
    expectRoutine("The oil looks white and cloudy in the cold");
    expectRoutine("you're not responding to my emails");
    expectRoutine("The website is not responding when I pay");
    expectRoutine("my daughter had some trouble logging in");
    expectRoutine("the new cap fits back on fine");
    expectRoutine("I've had more than I can take with your service");
    expectRoutine("I'm spewing, my order is late again");
  });
});

describe("rules: a death reported without the usual words (review round 2)", () => {
  const cases = [
    "Hi, Dad won't be needing the deliveries anymore, he's gone. What do I do with the rest of the oil?",
  ];
  for (const text of cases) {
    it(`bereavement: ${text}`, () => {
      expectCategory(text, "bereavement");
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }

  it("does not read someone going out, away or missing as a death", () => {
    expectRoutine("He's gone to the shops, can he call you back?");
    expectRoutine("She's gone away for the week, please hold the parcel at the depot");
    expectRoutine("the parcels, they've gone missing again");
  });
});

describe("rules: side effects and clinical questions in everyday words (review round 2)", () => {
  const sideEffects = [
    "my hands wont stop trembling",
    "my heart feels like it's fluttering and I get this pounding in my ears",
    "been throwin up every mornin",
    "had a really bad trip on the oil last night",
    "the last lot gave me the worst stomach and i keep going to the loo",
    "my blood pressure is really high since the new oil",
    "been spewing all night",
  ];
  for (const text of sideEffects) {
    it(`side effect: ${text}`, () => {
      expectCategory(text, "side_effect");
      expect(route(text)?.route).toBe("clinician");
    });
  }

  const clinical = [
    "can i take it b4 my flight to bali next week",
    "how much should u take",
  ];
  for (const text of clinical) {
    it(`clinical question: ${text}`, () => {
      expectCategory(text, "clinical_question");
      expect(route(text)?.route).toBe("clinician");
    });
  }
});

describe("rules: blood pressure (review round 2)", () => {
  it("labels a new blood pressure medicine as a clinical question, not a side effect", () => {
    const text = "My GP started me on blood pressure tablets today. Is it OK to keep taking my capsules alongside them";
    expect([...cats(text)]).toEqual(["clinical_question"]);
    expect(route(text)).toEqual({ route: "clinician", holdOrders: false });
  });

  it("labels blood pressure as a side effect only when it is described as a symptom", () => {
    for (const text of ["my blood pressure is up since the new bottle", "I've had low blood pressure since starting", "blood pressure keeps dropping"]) {
      expectCategory(text, "side_effect");
    }
  });
});

describe("rules: review round 3, urgent phrasings with misspellings and filler words", () => {
  const urgent: [string, Cat][] = [
    // MSG-0904, word for word: misspelt anaphylaxis and airway swelling in everyday words.
    ["is anyone on?? i think im having an anaphalactic reaction, my lips have gone all puffy and my tongue feels fat", "adverse_event"],
    ["my lips have gone all puffy", "adverse_event"],
    ["her lips are all swollen", "adverse_event"],
    ["my tongue feels fat", "adverse_event"],
    ["his tongue has gone thick", "adverse_event"],
    ["anaphylatic shock i think", "adverse_event"],
    ["pretty sure its anafylactic", "adverse_event"],
    ["i don't see the point anymore", "crisis"],
    ["honestly dont see any point in anything", "crisis"],
    ["there's no point going on", "crisis"],
    ["think i oded on the capsules last night", "adverse_event"],
    ["been having suicdal thoughts again", "crisis"],
    ["honestly just want to stop existing. tired of everything", "crisis"],
    ["im going to take them all tonight", "crisis"],
    ["I've got the pills lined up on the bench", "crisis"],
    ["i cant keep living like this", "crisis"],
    ["We lost him on Sunday. Please close his account", "bereavement"],
    ["Nan has gone to be with Grandad now", "bereavement"],
    ["My husband's lips look a bit bluish and he can't keep his eyes open", "adverse_event"],
    ["my partner is completely out of it and I can't get him to wake up properly", "adverse_event"],
    ["i took like 3x the drops last nite by accident and now i cant stop shaking", "adverse_event"],
    ["my nephew found my capsules and i think he ate a couple", "adverse_event"],
    ["My throat feels scratchy and it's hard to swallow", "adverse_event"],
    ["woke up and couldn't feel the left side of my face", "adverse_event"],
    ["my chest feels weird and my left arm has gone all tingly", "adverse_event"],
    ["Since I upped the oil I'm convinced the neighbours are watching me through the walls", "adverse_event"],
    ["he had a sezure this morning", "adverse_event"],
    // The red-team slice (MSG-0901 to MSG-0922), in their own words.
    ["i just want to go to sleep and stay asleep, like for good", "crisis"],
    ["honestly i dont wanna b here anymore, everythings pointless", "crisis"],
    ["She took a funny turn at lunch today. She went grey and couldn't get her words out", "adverse_event"],
    ["they're keeping her in overnight", "adverse_event"],
    ["my husband marcus pased away sunday night", "bereavement"],
    ["she's been thinking about taking her own life", "crisis"],
    ["Mum went in her sleep on Monday night", "bereavement"],
    ["Kwame was in a car accident last night and didn't make it.", "bereavement"],
    ["Nie chcę już żyć. Nie wiem, co robić.", "crisis"],
    ["A minha mãe faleceu ontem.", "bereavement"],
    ["mio figlio di 4 anni ha bevuto un po' del mio olio", "adverse_event"],
  ];
  for (const [text, category] of urgent) {
    it(`${category}: ${text}`, () => {
      expectCategory(text, category);
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }

  it("keeps everyday lookalikes routine", () => {
    for (const text of [
      "The parcel didn't make it before the weekend, can you check?",
      "Sorry I didn't make it to my appointment, can I rebook?",
      "I didn't make it, sorry, can we reschedule?",
      "thanks for keeping me in the loop",
      "should I keep them in the fridge? keeping them in the cupboard now",
      "that price rise is hard to swallow",
      "I lost her parcel tracking number",
      "we lost her password, can you reset it",
      "should I stop my plan while I'm away?",
      "Can you ship them all in one box?",
      "I'll take them all in one order",
      "my analysis of the invoice shows an extra charge",
      "the courier took a wrong turn",
      "the oil helps me stay asleep",
      "face cream box was blue",
    ]) {
      expectRoutine(text);
    }
  });
});

describe("rules: review round 3, clinician phrasings", () => {
  const clinician: [string, Cat][] = [
    ["hey can i tke my oil wit the new antidepresants the gp gave me last wk?", "clinical_question"],
    ["The GP started Dad on something for his heart last week. Should he leave a gap between them?", "clinical_question"],
    ["omg we just found out we've got a little one on the way!! can I keep using my oil or should I stop for now?", "clinical_question"],
    ["for the last few nights my heart feels like it's skipping beats when I lie down", "side_effect"],
    ["I have been a bit wobbly on my feet and not quite with it in the mornings", "side_effect"],
    ["my heart's going a million miles an hour every time i take it", "side_effect"],
    ["I keep seeing double since the new bottle", "side_effect"],
    ["my tummy's been playing up ever since i started the capsules", "side_effect"],
    ["Just found out I'm 6 weeks along, is my oil still ok?", "clinical_question"],
    ["Bub is 3 months and I'm still feeding him myself, can I use the spray?", "clinical_question"],
    ["had a few wines at a bbq, ok to have my oil tonight?", "clinical_question"],
    ["am I right to get behind the wheel after my evening drops", "clinical_question"],
    ["can i take it with my ADHD meds", "clinical_question"],
    ["is it fine with my sertaline", "clinical_question"],
    ["ydy hi'n iawn i mi yrru ar ôl cymryd yr olew?", "clinical_question"],
  ];
  for (const [text, category] of clinician) {
    it(`${category}: ${text}`, () => {
      expectCategory(text, category);
      expect(route(text)?.route).toBe("clinician");
    });
  }

  it("names the medicine itself, not only the generic 'take it with'", () => {
    const phrases = (t: string) => checkRules(t).hits.filter((h) => h.ruleId === "clinical.named_medicine").map((h) => h.phrase.toLowerCase());
    expect(phrases("can i take it with my ADHD meds")).toEqual(["adhd meds"]);
    expect(phrases("is it fine with my sertaline")).toEqual(["sertaline"]);
    expect(phrases("the new antidepresants")).toEqual(["antidepresants"]);
  });
});

// ---------------- round 4: overuse, and whose death it is ----------------

describe("rules: repeated or ongoing overuse is an urgent adverse event (P10.1 to P10.4)", () => {
  const overuse = [
    "I've been taking more of my oil than I'm meant to at night.",
    "taking more of my oil than I'm meant to",
    "I'm using more of the spray than I'm supposed to.",
    "I've been having extra drops most nights.",
    "extra drops most nights, just to get to sleep",
    "Most nights I take extra drops to sleep.",
    "I keep going over my prescribed amount, most days now. Can you send the next order early?",
    "I've gone over the prescribed dose a few times this week.",
    "I've been doubling up on my capsules.",
    "I doubled up again last night.",
    "I'm finishing it early because I take more than I should.",
    "It runs out early because I've been using more.",
    "I take twice what I'm prescribed.",
    "More than the doctor said, most nights.",
    "I keep taking more, it's the only thing that helps.",
    "I've been taking an extra capsule every morning.",
    "I'm using more and more of it.",
    "I've been having more of the oil than the script says, more than the script said.",
  ];
  for (const text of overuse) {
    it(`urgent with a hold: ${text}`, () => {
      expect(primarySafetyCategory(checkRules(text).hits)).toBe("adverse_event");
      expect(route(text)).toEqual({ route: "urgent", holdOrders: true });
    });
  }

  // A one-off question about the dose is still a clinical question, and delivery wording is not overuse.
  const question = ["Can I take more?", "Can I take extra drops if my pain is bad?", "Is it ok to double up if I miss a dose?", "Should I take more at night?"];
  for (const text of question) {
    it(`a question stays with a clinician: ${text}`, () => {
      expect(route(text)?.route).toBe("clinician");
      expect(cats(text).has("adverse_event")).toBe(false);
    });
  }
  const routine = [
    "Can you double up my next order?",
    "We have doubled up on packaging, thanks for the tip.",
    "I've been having more trouble with the app than usual.",
    "It is taking more time than I expected to arrive.",
  ];
  for (const text of routine) {
    it(`not overuse: ${text}`, () => {
      expect(cats(text).has("adverse_event")).toBe(false);
    });
  }
});

describe("rules: a death mentioned by the living patient (MSG-0172) versus a possible patient death", () => {
  const living = (t: string) => checkRules(t).hits.find((h) => h.ruleId === LIVING_PATIENT_RULE_ID);

  const alive = [
    "My brother Josh died three weeks ago. I've been taking more of my oil than I'm meant to at night.",
    "My husband passed away last month. I'm still using my capsules every night but I can't sleep.",
    "Mum died on Sunday and I've been having extra drops most nights to cope.",
    "Since Dad's funeral I keep taking more than I should.",
    "My sister passed away. Is my oil still ok to use with the sleeping tablets they gave me?",
  ];
  for (const text of alive) {
    it(`the patient's own care leads: ${text}`, () => {
      const { hits } = checkRules(text);
      expect(living(text), text).toBeDefined();
      expect(living(text)!.category).toBe("adverse_event");
      expect(isLivingPatientReport(hits)).toBe(true);
      expect(primarySafetyCategory(hits)).not.toBe("bereavement");
      expect(routeForHits(hits)).toEqual({ route: "urgent", holdOrders: true });
      // The death words are still found, so a clinician sees that a death was mentioned.
      expect(hits.some((h) => h.category === "bereavement")).toBe(true);
    });
  }

  it("quotes the overuse words when the patient wrote them", () => {
    const text = "My brother died. I've been taking more of my oil than I'm meant to.";
    expect(living(text)?.phrase).toBe("taking more of my oil than I'm meant to");
  });

  const maybePatient = [
    "My husband passed away last week, please cancel his orders.",
    "My dad passed away last month. Please change my delivery address.",
    "Mum died on Sunday. She had been taking more of her oil than prescribed.",
    "My brother died and I've been taking it hard.",
    "Dad passed away. I've been giving him his capsules every night until the end.",
  ];
  for (const text of maybePatient) {
    it(`stays a possible patient death (the safe side): ${text}`, () => {
      const { hits } = checkRules(text);
      expect(living(text), text).toBeUndefined();
      expect(isLivingPatientReport(hits)).toBe(false);
      expect(primarySafetyCategory(hits)).toBe("bereavement");
    });
  }

  it("adds no living-patient hit when no death is mentioned", () => {
    expect(living("I've been taking my oil every night and it helps.")).toBeUndefined();
  });
});

// ---------------- round 5: overuse in more everyday words, and whose death it is ----------------

describe("rules: overuse in more everyday words is urgent with a hold (review round 5)", () => {
  const overuse = [
    "Lately I use about twice as much as I'm told to.",
    "I've gone well past my prescribed dose most weeks.",
    "I keep topping up with extra capsules in the evening.",
    "I've started taking three capsules instead of one.",
    "I'm getting through my bottle much faster than I should.",
    "Honestly I've been overdoing the drops every night.",
    "I'm using three times as many drops as the doctor said.",
    "I always have another capsule before bed.",
    "I keep running out early because I take extra.",
  ];
  for (const text of overuse) {
    it(`urgent with a hold: ${text}`, () => {
      expect(primarySafetyCategory(checkRules(text).hits)).toBe("adverse_event");
      expect(routeForHits(checkRules(text).hits)).toEqual({ route: "urgent", holdOrders: true });
    });
  }
  const routine = [
    "Can I top up my account with a gift card?",
    "The parcel is getting through customs faster than expected.",
    "I've been overdoing it at the gym lately.",
    "I always order another bottle before I run out.",
  ];
  for (const text of routine) {
    it(`not overuse: ${text}`, () => {
      expect(checkRules(text).hits.some((h) => h.category === "adverse_event")).toBe(false);
    });
  }
});

describe("rules: whose death it is, review round 5", () => {
  const living = (t: string, firstName?: string) =>
    checkRules(t, { firstName }).hits.find((h) => h.ruleId === LIVING_PATIENT_RULE_ID || h.ruleId === RELATIVE_DEATH_RULE_ID);

  // "My oil" in an order phrase, or a writer acting for the person who died, never reads as the living patient.
  const maybePatient = [
    "I'm writing for my father. He died yesterday. I've been using his account to cancel. My oil order is not needed.",
    "He passed away last night. I've been taking care of his things; please cancel my oil subscription for him.",
    "Mum passed away. I have been taking the capsules she left",
    "Dad died on Friday. Please cancel my oil.",
    "My husband passed away. My capsules order can be stopped.",
    "I am writing on behalf of my wife, who died on Sunday. I've been taking my oil as usual.",
  ];
  for (const text of maybePatient) {
    it(`stays a possible patient death: ${text}`, () => {
      const { hits } = checkRules(text, { firstName: "Mele" });
      expect(living(text, "Mele"), text).toBeUndefined();
      expect(isLivingPatientReport(hits)).toBe(false);
      expect(primarySafetyCategory(hits)).toBe("bereavement");
      expect(reportsPatientDeath({ route: "urgent", rules: { hits } })).toBe(true);
    });
  }

  it("MSG-0120: a relative's death signed with the patient's own name is not the patient's death", () => {
    const text =
      "Kia ora,\n\nMy dad passed away last month. He was the one who signed for my parcels at his house.\n\nCould you please change my delivery address.\n\nThank you for understanding.\n\nMele Taufa";
    const { hits } = checkRules(text, { firstName: "Mele" });
    const hit = hits.find((h) => h.ruleId === RELATIVE_DEATH_RULE_ID);
    expect(hit?.category).toBe("bereavement");
    expect(hit?.phrase).toBe("My dad passed away");
    expect(isLivingPatientReport(hits)).toBe(true);
    expect(reportsPatientDeath({ route: "urgent", rules: { hits } })).toBe(false);
    // Still stopped as urgent, and the death still names the stop: only the patient-level withdrawal changes.
    expect(routeForHits(hits)).toEqual({ route: "urgent", holdOrders: true });
    expect(primarySafetyCategory(hits)).toBe("bereavement");
    // Without the patient's name the rules cannot tell, so it stays a possible patient death.
    expect(isLivingPatientReport(checkRules(text).hits)).toBe(false);
    // Signed by someone else (a relative reporting the patient's death): the safe side.
    expect(isLivingPatientReport(checkRules(text.replace("Mele Taufa", "Sione Taufa"), { firstName: "Mele" }).hits)).toBe(false);
  });

  it("the MSG-0172 reading is unchanged: living patient, adverse event first", () => {
    const text = "My brother Josh died three weeks ago. I've been taking more of my oil than I'm meant to at night.\n\nCharlotte Brown";
    const { hits } = checkRules(text, { firstName: "Charlotte" });
    expect(isLivingPatientReport(hits)).toBe(true);
    expect(primarySafetyCategory(hits)).toBe("adverse_event");
  });
});
