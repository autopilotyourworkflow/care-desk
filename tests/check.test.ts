import { describe, it, expect } from "vitest";
import { checkDraft, clinicianReason, isClinicalBan, policyReason, summariseCheck } from "@/lib/pipeline/check";
import type { Patient, SourceRef } from "@/lib/types";
import { searchPolicy, selectRecords } from "@/lib/pipeline/retrieve";
import patientsData from "@/data/patients.json";

const ORDER: SourceRef = {
  id: "ORD-20481",
  kind: "order",
  label: "Order ORD-20481, shipped 18 Sep",
  text:
    "Order ORD-20481: status shipped; placed 16 September 2026; shipped 18 September 2026; carrier Courierline; " +
    "tracking CD4829103756; estimated delivery 22 September 2026; items: Oil, 25 mL x1; total AUD 129.00",
};
const PLAN: SourceRef = {
  id: "PLAN",
  kind: "plan",
  label: "Plan: Monthly treatment plan, active",
  text: "Plan: Monthly treatment plan; status active; price AUD 129.00 per month; started 3 March 2026; next billing date 1 October 2026",
};
const REFUND: SourceRef = {
  id: "CHG-30004",
  kind: "charge",
  label: "Refund CHG-30004, 5 Sep, AUD 40.00",
  text: "Charge CHG-30004: Refund, late delivery; refund of AUD 40.00; status refunded; charged 5 September 2026; type refund",
};
const APPT: SourceRef = {
  id: "APT-40002",
  kind: "appointment",
  label: "Appointment APT-40002, 29 Sep, booked",
  text: "Appointment APT-40002: renewal consult; 29 September 2026 at 3:30 pm (patient's local time); clinician Dr Hana Whitlock; status booked",
};
const POLICY: SourceRef = {
  id: "P3.1",
  kind: "policy",
  label: "Policy P3.1: Delivery times",
  text:
    "Orders ship within 24 hours of pharmacy approval. Delivery takes 2 to 5 business days in metro areas and one to two " +
    "weeks for remote areas. Our team replies Monday to Friday, 9 am to 5 pm. Price rises come with 30 days notice and are capped at 5%.",
  score: 4.2,
};
const NZ_PLAN: SourceRef = { id: "PLAN", kind: "plan", label: "Plan", text: "Plan: Monthly plan; price NZD 89.00 per month" };
const UK_PLAN: SourceRef = { id: "PLAN", kind: "plan", label: "Plan", text: "Plan: Monthly plan; price GBP 49.99 per month" };

const ALL = [ORDER, PLAN, REFUND, APPT, POLICY];

function fact(text: string, draft: string, sources: SourceRef[] = ALL) {
  return checkDraft(draft, sources).facts.find((f) => f.text === text);
}

describe("check: a clean draft passes", () => {
  it("verifies every fact in a typical order-status draft", () => {
    const draft =
      "Hi [NAME], thanks for your patience. Your order ORD-20481 shipped on 18 September [1] with Courierline, " +
      "tracking CD4829103756 [1]. It should arrive by Tuesday 22 September [1]. Metro deliveries usually take 2 to 5 " +
      "business days [2].";
    const r = checkDraft(draft, ALL);
    expect(r.passed).toBe(true);
    expect(r.banned).toEqual([]);
    expect(r.facts.map((f) => [f.text, f.kind, f.found, f.sourceId])).toEqual([
      ["ORD-20481", "order_id", true, "ORD-20481"],
      ["18 September", "date", true, "ORD-20481"],
      ["CD4829103756", "tracking", true, "ORD-20481"],
      ["Tuesday 22 September", "date", true, "ORD-20481"],
      ["2 to 5 business days", "duration", true, "P3.1"],
    ]);
  });

  it("passes a draft with no checkable facts", () => {
    const r = checkDraft("Thanks for letting us know. A member of the team will be in touch soon.", ALL);
    expect(r).toEqual({ facts: [], banned: [], passed: true });
  });

  it("does not treat citation markers as facts", () => {
    expect(checkDraft("Thanks [1] [2] [3]", ALL).facts).toEqual([]);
  });
});

describe("check: dates", () => {
  const forms = [
    "18 September",
    "18 Sep",
    "18th of September",
    "September 18",
    "Friday 18 September",
    "Friday, 18 September 2026",
    "18/09/2026",
    "18/9",
    "18.09.2026",
    "2026-09-18",
    "18 September 2026",
  ];
  for (const form of forms) {
    it(`finds "${form}" in the sources`, () => {
      const r = checkDraft(`It shipped on ${form}.`, ALL);
      expect(r.facts).toHaveLength(1);
      expect(r.facts[0]).toMatchObject({ kind: "date", found: true, sourceId: "ORD-20481" });
    });
  }

  it("fails a date that is not in any source", () => {
    expect(fact("23 September", "It will arrive on 23 September.")).toMatchObject({ kind: "date", found: false });
    expect(fact("19/09/2026", "It shipped 19/09/2026.")?.found).toBe(false);
  });

  it("fails a weekday that does not match the date", () => {
    // 22 September 2026 is a Tuesday.
    expect(fact("Wednesday 22 September", "Arriving Wednesday 22 September.")?.found).toBe(false);
    expect(fact("Tuesday 22 September", "Arriving Tuesday 22 September.")?.found).toBe(true);
  });

  it("fails a year that contradicts the source", () => {
    expect(fact("18 September 2025", "It shipped on 18 September 2025.")?.found).toBe(false);
  });

  it("checks a weekday on its own against the source dates and wording", () => {
    // Today is Wednesday 23 September. The estimated delivery (22 September) was yesterday, a Tuesday, so "should
    // arrive by Tuesday" means Tuesday 29 September, which no delivery source gives.
    expect(fact("Tuesday", "It should arrive by Tuesday.", [ORDER, POLICY])?.found).toBe(false);
    expect(fact("Tuesday", "It should arrive by Tuesday.", [{ ...ORDER, text: "Order ORD-20481: estimated delivery 29 September 2026" }])?.found).toBe(true);
    expect(fact("Tuesday", "It was meant to arrive by Tuesday.", [ORDER, POLICY])?.found).toBe(true);
    expect(fact("Monday", "We reply Monday to Friday.")).toMatchObject({ found: true, sourceId: "P3.1" });
    expect(fact("on Sunday", "It will be there on Sunday.", [ORDER])?.found).toBe(false);
  });
});

describe("check: relative dates (today is Wednesday 23 September 2026)", () => {
  const ETA_THU: SourceRef = { ...ORDER, text: ORDER.text.replace("estimated delivery 22 September 2026", "estimated delivery 24 September 2026") };

  it("resolves tomorrow and yesterday against the demo's today", () => {
    expect(fact("tomorrow", "It should arrive tomorrow [1].", [ETA_THU])?.found).toBe(true);
    expect(fact("tomorrow", "It should arrive tomorrow [1].", [ORDER])).toMatchObject({ kind: "date", found: false });
    expect(fact("yesterday", "It was delivered yesterday [1].", [{ ...ORDER, text: "Order ORD-20481: delivered 22 September 2026" }])?.found).toBe(true);
  });

  it("uses a passed-in today rather than a clock", () => {
    const r = checkDraft("It should arrive tomorrow [1].", [ORDER], { today: "2026-09-21" });
    expect(r.facts.find((f) => f.text === "tomorrow")?.found).toBe(true);
    expect(r.passed).toBe(true);
  });

  it("checks this, next and on with a weekday", () => {
    expect(fact("this Thursday", "It should be with you this Thursday [1].", [ETA_THU])?.found).toBe(true);
    expect(fact("this Friday", "It should be with you this Friday [1].", [ETA_THU])?.found).toBe(false);
    // "next Friday" said on Wednesday 23 September can mean 25 September or 2 October.
    const oct2: SourceRef = { ...ORDER, text: "Order ORD-20481: estimated delivery 2 October 2026" };
    expect(fact("next Friday", "It should arrive next Friday [1].", [oct2])?.found).toBe(true);
    expect(fact("on Thursday", "It should arrive on Thursday [1].", [ETA_THU])?.found).toBe(true);
    expect(fact("on Tuesday", "It was due on Tuesday [1].", [ORDER])?.found).toBe(true); // 22 Sep, looking back
  });

  it("treats 'today' as a fact only when it makes a claim", () => {
    expect(fact("today", "It will arrive today [1].", [ORDER])?.found).toBe(false);
    expect(checkDraft("Thanks for getting in touch today. Your order ORD-20481 shipped on 18 September [1].", [ORDER]).passed).toBe(true);
  });

  it("still accepts 'on Monday' when a policy names the weekday", () => {
    expect(fact("on Monday", "Our team will reply on Monday [1].", [POLICY])?.found).toBe(true);
  });
});

describe("check: literal ids and amounts in local style", () => {
  it("matches order ids as whole ids only", () => {
    const src: SourceRef = { ...ORDER, id: "ORD-20011", label: "Order ORD-20011", text: "Order ORD-20011: status shipped" };
    expect(fact("ORD-2001", "Your order ORD-2001 has shipped [1].", [src])?.found).toBe(false);
    expect(fact("ORD-20011", "Your order ORD-20011 has shipped [1].", [src])?.found).toBe(true);
    expect(fact("CD4829103", "Tracking CD4829103 [1].", [ORDER])).toBeUndefined(); // not a tracking number shape
  });

  it("reads '$129.00 AUD' sources and keeps the currency code", () => {
    const local: SourceRef = { ...PLAN, text: "Plan: Monthly treatment plan; price $129.00 AUD per month" };
    expect(fact("$129", "Your plan is $129 a month [1].", [local])?.found).toBe(true);
    expect(fact("AUD 129.00", "Your plan is AUD 129.00 a month [1].", [local])?.found).toBe(true);
    expect(fact("$129.00 AUD", "Your plan is $129.00 AUD a month [1].", [local])?.found).toBe(true);
    expect(fact("$129.00 NZD", "Your plan is $129.00 NZD a month [1].", [local])?.found).toBe(false);
    expect(fact("£112", "It is now £112 [1].", [{ ...UK_PLAN, text: "Plan: Monthly plan; price £112.00 per month" }])?.found).toBe(true);
  });

  it("uses the label as well as the text", () => {
    expect(fact("18 Sep", "Shipped 18 Sep.", [{ ...ORDER, text: "Order ORD-20481" }])?.found).toBe(true);
  });

  it("does not read '24/7' or decimals as dates", () => {
    const r = checkDraft("Our chat is open 24/7 and 3.5 stars is not a date.", ALL);
    expect(r.facts.filter((f) => f.kind === "date")).toEqual([]);
  });
});

describe("check: amounts", () => {
  const found = ["$129", "$129.00", "AUD 129.00", "AUD129", "A$129", "AU$129.00", "129 dollars", "129.00 AUD", "$40"];
  for (const amount of found) {
    it(`finds "${amount}"`, () => {
      const r = checkDraft(`That was ${amount} in total.`, ALL);
      expect(r.facts).toHaveLength(1);
      expect(r.facts[0]).toMatchObject({ kind: "amount", found: true });
    });
  }

  it("compares amounts numerically and records the source", () => {
    expect(fact("$129", "Your plan is $129 a month.", [PLAN])).toMatchObject({ found: true, sourceId: "PLAN" });
    expect(fact("$40", "We refunded $40.", [REFUND])).toMatchObject({ found: true, sourceId: "CHG-30004" });
  });

  it("fails an amount that is not in the sources", () => {
    expect(fact("$139", "Your plan is $139.")?.found).toBe(false);
    expect(fact("$129.50", "Your plan is $129.50.")?.found).toBe(false);
  });

  it("handles NZ dollars and pounds, and rejects the wrong currency", () => {
    expect(fact("NZ$89", "Your plan is NZ$89.", [NZ_PLAN])?.found).toBe(true);
    expect(fact("$89", "Your plan is $89.", [NZ_PLAN])?.found).toBe(true);
    expect(fact("£49.99", "Your plan is £49.99.", [UK_PLAN])?.found).toBe(true);
    expect(fact("49.99 pounds", "It costs 49.99 pounds.", [UK_PLAN])?.found).toBe(true);
    expect(fact("£129", "Your plan is £129.", [PLAN])?.found).toBe(false);
    expect(fact("NZ$129", "Your plan is NZ$129.", [PLAN])?.found).toBe(false);
  });

  it("reads thousands separators", () => {
    const src: SourceRef = { id: "CHG-1", kind: "charge", label: "Charge", text: "amount AUD 1290.00" };
    expect(fact("$1,290", "That is $1,290.", [src])?.found).toBe(true);
  });
});

describe("check: ids, tracking, durations, times and percentages", () => {
  it("checks order ids and tracking numbers literally", () => {
    expect(fact("ORD-20481", "Order ORD-20481 is on its way.")).toMatchObject({ kind: "order_id", found: true });
    expect(fact("ORD-20482", "Order ORD-20482 is on its way.")).toMatchObject({ kind: "order_id", found: false });
    expect(fact("CD4829103756", "Tracking CD4829103756.")).toMatchObject({ kind: "tracking", found: true });
    expect(fact("CD4829103757", "Tracking CD4829103757.")).toMatchObject({ kind: "tracking", found: false });
  });

  it("checks other record ids", () => {
    expect(fact("CHG-30004", "Refund CHG-30004 went through.")).toMatchObject({ kind: "other", found: true, sourceId: "CHG-30004" });
    expect(fact("APT-49999", "Your booking APT-49999.")?.found).toBe(false);
  });

  it("compares durations as number pairs", () => {
    expect(fact("2 to 5 business days", "It takes 2 to 5 business days.")?.found).toBe(true);
    expect(fact("2-5 days", "It takes 2-5 days.")?.found).toBe(true);
    expect(fact("two to five business days", "It takes two to five business days.")?.found).toBe(true);
    expect(fact("one to two weeks", "Remote areas take one to two weeks.")?.found).toBe(true);
    expect(fact("1-2 weeks", "Remote areas take 1-2 weeks.")?.found).toBe(true);
    expect(fact("within 24 hours", "We ship within 24 hours.")).toMatchObject({ kind: "duration", found: true, sourceId: "P3.1" });
    expect(fact("up to 5 business days", "It can take up to 5 business days.")?.found).toBe(true);
    expect(fact("5 business days", "It takes 5 business days.")?.found).toBe(true);
    expect(fact("30 days", "You get 30 days notice.")?.found).toBe(true);
  });

  it("fails durations that are not in the sources", () => {
    expect(fact("3-5 days", "It takes 3-5 days.")?.found).toBe(false);
    expect(fact("2 to 5 weeks", "It takes 2 to 5 weeks.")?.found).toBe(false);
    expect(fact("within 48 hours", "We ship within 48 hours.")?.found).toBe(false);
    // "one to two weeks" in the source does not support "within a week": a single figure must be the upper end.
    expect(fact("within a week", "It will be there within a week.")?.found).toBe(false);
    expect(fact("2 business days", "It takes 2 business days.")?.found).toBe(false);
  });

  it("does not read 'a' as a number without a time-frame word before it", () => {
    expect(checkDraft("Have a lovely day.", ALL).facts).toEqual([]);
  });

  it("checks times of day", () => {
    expect(fact("5pm", "We reply by 5pm.")).toMatchObject({ kind: "time", found: true, sourceId: "P3.1" });
    expect(fact("5 p.m.", "We reply by 5 p.m.")?.found).toBe(true);
    expect(fact("3:30pm", "Your consult is at 3:30pm.")).toMatchObject({ found: true, sourceId: "APT-40002" });
    expect(fact("15:30", "Your consult is at 15:30.")?.found).toBe(true);
    expect(fact("4pm", "Your consult is at 4pm.")?.found).toBe(false);
    expect(fact("noon", "We reply by noon.")?.found).toBe(false);
  });

  it("checks percentages", () => {
    expect(fact("5%", "Rises are capped at 5%.")).toMatchObject({ kind: "other", found: true });
    expect(fact("10 per cent", "Rises are capped at 10 per cent.")?.found).toBe(false);
  });

  it("lists each distinct fact once", () => {
    const r = checkDraft("ORD-20481 shipped. Again, ORD-20481 shipped.", ALL);
    expect(r.facts.filter((f) => f.text === "ORD-20481")).toHaveLength(1);
  });

  it("fails the whole draft when any single fact is missing", () => {
    const r = checkDraft("Order ORD-20481 shipped 18 September and costs $139.", ALL);
    expect(r.passed).toBe(false);
    expect(r.facts.filter((f) => !f.found).map((f) => f.text)).toEqual(["$139"]);
  });

  it("fails every fact when there are no sources", () => {
    const r = checkDraft("Order ORD-20481 shipped 18 September.", []);
    expect(r.passed).toBe(false);
    expect(r.facts.every((f) => !f.found && f.sourceId === undefined)).toBe(true);
  });
});

describe("check: banned content", () => {
  const dosing = [
    ["Try to take 0.5 mL each night.", "dosing figure: 0.5 mL"],
    ["Start with 2 drops under the tongue.", "dosing figure: 2 drops"],
    ["That is about 10 mg of the active ingredient.", "dosing figure: 10 mg"],
    ["Use 1 capsule twice a day.", "dosing figure: 1 capsule"],
    ["A few drops should be enough.", "dosing figure: A few drops"],
  ];
  for (const [draft, label] of dosing) {
    it(`blocks a dosing figure: ${draft}`, () => {
      const r = checkDraft(draft, ALL);
      expect(r.banned).toContain(label);
      expect(r.passed).toBe(false);
    });
  }

  it("allows the product size from the order record when it is not an instruction", () => {
    const r = checkDraft("Your Oil, 25 mL x1 shipped on 18 September.", ALL);
    expect(r.banned).toEqual([]);
    expect(r.passed).toBe(true);
  });

  const advice = [
    "You should take it with food.",
    "Increase your dose if it isn't helping.",
    "It is safe to drive the next day.",
    "It's safe to mix with alcohol.",
    "Please stop taking it for now.",
    "Try taking it earlier in the evening.",
    "Reduce your dose to half.",
  ];
  for (const draft of advice) {
    it(`blocks medical advice: ${draft}`, () => {
      const r = checkDraft(draft, ALL);
      expect(r.banned.some((b) => b.startsWith("medical advice: "))).toBe(true);
      expect(r.passed).toBe(false);
    });
  }

  // An agent's own edit is checked too: clinical advice in plain words must block Send (review round 2).
  const editedAdvice = [
    "It is fine to keep using it with your other medicine.",
    "Feel free to double the amount if it is not working.",
    "Stop using the oil for a few days and see if the dizziness settles.",
    "Just use a little less each night.",
    "You can have a glass of wine with it.",
    "It's fine to drive after your evening dose.",
    "Taking it with food should stop the nausea.",
    "That reaction is normal and nothing to worry about.",
  ];
  for (const draft of editedAdvice) {
    it(`blocks medical advice in an edit: ${draft}`, () => {
      const r = checkDraft(draft, ALL);
      expect(r.banned.some((b) => b.startsWith("medical advice: "))).toBe(true);
      expect(r.passed).toBe(false);
    });
  }

  // Review round 3: paraphrased advice in an agent's own words. The broad gate runs the patient-message safety lexicon
  // (lib/pipeline/rules.ts) over each sentence, plus instruction, dismissal and sharing patterns.
  const paraphrasedAdvice = [
    "Have a break from the oil until you feel better.",
    "Maybe skip tonight's dose and see how you go.",
    "I would hold off on the capsules for now.",
    "Mixing it with your blood pressure tablets is fine.",
    "Drinking is fine in moderation.",
    "Having a couple of beers should be ok.",
    "Driving is okay once you are used to it.",
    "Take one before bed.",
    "You can still use it while pregnant.",
    "Dizziness is a common side effect.",
    "Pause the treatment for two days.",
    "It won't affect your warfarin.",
    "Skip tonight's dose and see how you feel.",
    "Hold off on the oil until you feel better.",
    "Have a break from it for a few days.",
    "Don't take it tonight.",
    "Stop the capsules for now.",
    "Just take one at bedtime.",
    "Take it earlier in the evening.",
    "Try it in the morning instead of at night.",
    "Go ahead and take another one if you need it.",
    "It won't affect your blood pressure tablets.",
    "Mixing it with your antidepressant is fine.",
    "You can drive the next morning.",
    "You don't need to see a doctor about this.",
    "That sounds like a normal reaction.",
    "Lots of people get a headache at first; it passes.",
    "Your GP doesn't need to know about it.",
    "It's okay to give it to your husband too.",
    "Stopping suddenly is fine.",
  ];
  for (const draft of paraphrasedAdvice) {
    it(`blocks paraphrased clinical advice: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.banned.length).toBeGreaterThan(0);
      expect(r.banned.every(isClinicalBan)).toBe(true);
      expect(r.passed).toBe(false);
      expect(clinicianReason(r)).toBe("This reads as clinical advice: escalate it to a clinician.");
    });
  }

  // Claims about what the product does are for a clinician (therapeutic claims are restricted in AU, NZ and the UK).
  const productClaims = [
    "Most people find it helps with anxiety.",
    "Our oil is great for pain.",
    "It really helps with sleep.",
    "You'll feel much better once you start the capsules.",
    "It is very effective for anxiety.",
    "Many patients say it cured their insomnia.",
    "It should ease your arthritis.",
    "Cannabis is completely safe.",
    "Many patients find it helps with sleep.",
    "Give it a couple of weeks and it should start working.",
  ];
  for (const draft of productClaims) {
    it(`blocks a product claim: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.passed).toBe(false);
      expect(r.banned.length).toBeGreaterThan(0);
      expect(clinicianReason(r)).not.toBeNull();
    });
  }
  it("names the product-claim reason when only a claim is blocked", () => {
    const r = checkDraft("It should ease your arthritis.", []);
    expect(r.banned).toEqual(["product claim: It should ease your arthritis"]);
    expect(clinicianReason(r)).toBe("Claims about what the product does are for a clinician.");
  });

  const routineAgentText = [
    "I have passed your question about driving to a clinician, who will call you today.",
    "I've passed this to our clinical team, and a clinician will be in touch within one business day.",
    "Sorry this has been such a headache.",
    "I hope you feel better soon.",
    "Once you reset your password it should start working again.",
    "It helps us if you include your order number.",
    "You can pause your treatment plan from your account.",
    "Your capsules are on the way and should arrive tomorrow.",
    "Please take it to the post office in the morning.",
    "Have one of our team call you in the morning.",
    "The courier is driving your parcel over this afternoon.",
    "Your new address is 14 Banksia Drive.",
    "We have stopped the reminder texts.",
    "Prescription medicines need a signature, so we cannot deliver to parcel lockers.",
    "Your order was delivered on 16 September. Please don't use it for now. A pharmacist will contact you within 1 business day.",
  ];
  for (const draft of routineAgentText) {
    it(`allows routine agent wording: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.banned).toEqual([]);
      expect(clinicianReason(r)).toBeNull();
    });
  }

  it("blocks a dose written in words: Take two capsules at night.", () => {
    const r = checkDraft("Take two capsules at night.", ALL);
    expect(r.banned).toContain("dosing figure: two capsules");
    expect(r.passed).toBe(false);
  });

  const routineWording = [
    "If you have more questions, just reply here.",
    "You were charged double the amount by mistake, so we have refunded it.",
    "We can change the amount on your next charge.",
    "Your replacement ships as one spray bottle.",
    "You can keep using the app to track it.",
    "Please try again with a different card.",
  ];
  for (const draft of routineWording) {
    it(`allows routine wording: ${draft}`, () => {
      expect(checkDraft(draft, ALL).banned).toEqual([]);
    });
  }

  const promo = ["This is our strongest oil.", "A high THC option is available.", "Our best strain for sleep.", "It is very potent."];
  for (const draft of promo) {
    it(`blocks promotional wording: ${draft}`, () => {
      const r = checkDraft(draft, ALL);
      expect(r.banned.some((b) => b.startsWith("promotional wording: "))).toBe(true);
    });
  }

  it("blocks en and em dashes by code point, without printing the character", () => {
    const r = checkDraft("Your order shipped \u2014 it is on its way \u2013 soon.", ALL);
    expect(r.banned).toEqual(["dash character: U+2013 en dash", "dash character: U+2014 em dash"]);
    expect(r.passed).toBe(false);
    for (const b of r.banned) expect(b).not.toMatch(/[\u2013\u2014]/);
  });

  it("allows plain hyphens", () => {
    expect(checkDraft("A follow-up note: it takes 2-5 days.", [POLICY]).banned).toEqual([]);
  });

  it("reports an overlapping dosing phrase once", () => {
    const r = checkDraft("Take 10 mg twice a day.", ALL);
    expect(r.banned).toEqual(["dosing figure: 10 mg"]);
  });

  it("combines fact failures and banned content", () => {
    const r = checkDraft("Take 10 mg. It arrives 30 September.", ALL);
    expect(r.passed).toBe(false);
    expect(r.banned).toHaveLength(1);
    expect(r.facts[0]).toMatchObject({ text: "30 September", found: false });
  });
});

describe("check: summary", () => {
  it("summarises in plain words", () => {
    expect(summariseCheck(checkDraft("Thanks!", ALL))).toBe("No dates, amounts or order numbers to check");
    expect(summariseCheck(checkDraft("ORD-20481 shipped 18 September.", ALL))).toBe("2 facts checked, all found in the sources");
    expect(summariseCheck(checkDraft("ORD-20481 costs $1.", ALL))).toBe("1 of 2 facts not found in the sources");
    expect(summariseCheck(checkDraft("Take 10 mg.", ALL))).toBe("No dates, amounts or order numbers to check; 1 blocked phrase");
  });
});

// ---------------- round 2: country and meaning ----------------

// What retrieve.ts now gives an Australian patient for the handbook's multi-country sections (country-trimmed text).
const AU_DELIVERY: SourceRef = {
  id: "P4.1",
  kind: "policy",
  label: "Policy P4.1: Delivery times by country",
  text:
    "Every order travels with Courierline, tracked, and needs a signature on delivery. Delivery times are counted in business days from dispatch.\n\n" +
    "Australia, metro (capital cities and major centres such as Geelong, Newcastle and the Gold Coast): 1 to 3 business days. Australia, regional and remote: 3 to 6 business days.",
};
const DISPATCH: SourceRef = {
  id: "P3.1",
  kind: "policy",
  label: "Policy P3.1: Prescriptions, dispensing and dispatch",
  text: "Orders dispensed by 2 pm local time are dispatched the same business day. So a repeat order is usually dispatched 1 to 2 business days after the billing date.",
};
// A section whose figures are written for every country at once, as in the handbook's refunds section.
const ALL_COUNTRIES_REFUNDS: SourceRef = {
  id: "P5.3",
  kind: "policy",
  label: "Policy P5.3: Refunds and shipping fees",
  text: "Refunds go back to the original card and take 5 to 10 business days to appear. Refunds over A$250, NZ$270 or £150 need team lead approval. The one-off shipping fee (A$12, NZ$14 or £6.50) applies to sending again a returned parcel.",
};
const AU_PRICES: SourceRef = {
  id: "P5.4",
  kind: "policy",
  label: "Policy P5.4: Prices, price changes and concessions",
  text: "Monthly plan prices. Australia: one product A$148, two products A$214; concession A$118 and A$171.",
};
const AU_PLAN: SourceRef = { id: "PLAN", kind: "plan", label: "Plan: Monthly treatment plan, active", text: "Plan: Monthly treatment plan; status active; price $148.00 AUD per month" };
const AU_SOURCES = [AU_PLAN, AU_DELIVERY, DISPATCH, ALL_COUNTRIES_REFUNDS, AU_PRICES];

describe("check: another country's figures never pass (review round 2)", () => {
  it("rejects a price in another country's currency", () => {
    expect(fact("£112", "A one-product plan is £112 a month.", AU_SOURCES)?.found).toBe(false);
    expect(fact("NZ$236", "It costs NZ$236.", AU_SOURCES)?.found).toBe(false);
    expect(fact("A$148", "A one-product plan is A$148 a month.", AU_SOURCES)?.found).toBe(true);
    expect(fact("A$214", "A two-product plan is A$214 a month.", AU_SOURCES)).toMatchObject({ found: true, sourceId: "P5.4" });
    expect(fact("$148", "It costs $148.", AU_SOURCES)?.found).toBe(true);
  });

  it("rejects another country's figure even when a policy lists every country together", () => {
    expect(fact("£150", "Refunds over £150 need approval.", AU_SOURCES)?.found).toBe(false);
    expect(fact("$270", "Refunds over $270 need approval.", AU_SOURCES)?.found).toBe(false);
    expect(fact("A$250", "Refunds over A$250 need approval.", AU_SOURCES)?.found).toBe(true);
    expect(fact("$12", "The one-off shipping fee is $12.", AU_SOURCES)?.found).toBe(true);
  });

  it("reads the patient's currency from the records, or takes it from opts", () => {
    const uk: SourceRef[] = [{ ...UK_PLAN }, ALL_COUNTRIES_REFUNDS];
    expect(checkDraft("Refunds over £150 need approval.", uk).passed).toBe(true);
    expect(checkDraft("Refunds over A$250 need approval.", uk).passed).toBe(false);
    // A dollar sign is never a pound.
    expect(checkDraft("Refunds over $150 need approval.", uk).passed).toBe(false);
    // With no records, opts.currency decides.
    expect(checkDraft("Refunds over £150 need approval.", [ALL_COUNTRIES_REFUNDS], { currency: "AUD" }).passed).toBe(false);
    expect(checkDraft("Refunds over £150 need approval.", [ALL_COUNTRIES_REFUNDS], { currency: "GBP" }).passed).toBe(true);
    // No records and no opts: any of the listed figures is accepted, as before.
    expect(checkDraft("Refunds over £150 need approval.", [ALL_COUNTRIES_REFUNDS]).passed).toBe(true);
  });
});

describe("check: a time frame must be about the same thing (review round 2)", () => {
  it("does not accept a dispatch window as a delivery window", () => {
    expect(fact("in 1 to 2 business days", "Your order should arrive in 1 to 2 business days.", AU_SOURCES)?.found).toBe(false);
    expect(fact("in 1 to 3 business days", "Your order should arrive in 1 to 3 business days.", AU_SOURCES)).toMatchObject({
      found: true,
      sourceId: "P4.1",
    });
  });

  it("accepts the dispatch window for dispatch, and a refund window for refunds", () => {
    expect(
      fact("1 to 2 business days", "It is usually dispatched 1 to 2 business days after your billing date.", AU_SOURCES),
    ).toMatchObject({ found: true, sourceId: "P3.1" });
    expect(fact("5 to 10 business days", "Your refund can take 5 to 10 business days to appear.", AU_SOURCES)?.found).toBe(true);
    expect(fact("in 5 to 10 business days", "Your order will arrive in 5 to 10 business days.", AU_SOURCES)?.found).toBe(false);
  });

  it("reads the words after a figure when the words before it say nothing", () => {
    expect(fact("1 to 3 business days", "Metro orders take 1 to 3 business days to arrive.", AU_SOURCES)?.found).toBe(true);
    expect(fact("1 to 2 business days", "Metro orders take 1 to 2 business days to arrive.", AU_SOURCES)?.found).toBe(false);
  });
});

describe("check: PT-1001 (Australia) with the real handbook (review round 2)", () => {
  const pt = (patientsData as unknown as Patient[]).find((p) => p.id === "PT-1001")!;
  const sources: SourceRef[] = [
    ...selectRecords(pt, "order_status"),
    ...searchPolicy("has my september order shipped yet? will it get here before friday", "order_status", "AU"),
    ...searchPolicy("how much is a one product or two product plan", "price_change", "AU"),
  ];

  it("has the delivery and price sections to check against", () => {
    const ids = sources.map((s) => s.id);
    expect(ids).toContain("P4.1");
    expect(ids).toContain("P5.4");
  });

  it("blocks a UK price, an NZ price and the UK delivery window", () => {
    expect(checkDraft("A one-product plan is £112 a month.", sources).passed).toBe(false);
    expect(checkDraft("It costs NZ$236.", sources).passed).toBe(false);
    expect(checkDraft("Your order should arrive in 1 to 2 business days.", sources).passed).toBe(false);
  });

  it("passes the Australian figures", () => {
    expect(checkDraft("A one-product plan is A$148 a month.", sources).passed).toBe(true);
    expect(checkDraft("Metro orders usually arrive in 1 to 3 business days.", sources).passed).toBe(true);
  });
});

describe("check: weekdays follow the tense (review round 3)", () => {
  // PT-1001, ORD-20004: placed Friday 18 September, shipped Monday 21 September, estimated delivery Thursday 24
  // September. Today is Wednesday 23 September.
  const pt = (patientsData as unknown as Patient[]).find((p) => p.id === "PT-1001")!;
  const sources: SourceRef[] = [
    ...selectRecords(pt, "order_status"),
    ...searchPolicy("has my september order shipped yet? will it get here before friday", "order_status", "AU"),
  ];
  const found = (draft: string, text: string) => checkDraft(draft, sources).facts.find((f) => f.text === text)?.found;

  it("fails a future weekday that only matches the placed or shipped date", () => {
    expect(found("It will arrive by Friday.", "Friday")).toBe(false);
    expect(found("It will arrive on Friday.", "on Friday")).toBe(false);
    expect(found("It will be with you on Monday.", "on Monday")).toBe(false);
    expect(checkDraft("It will arrive by Friday.", sources).passed).toBe(false);
  });

  it("passes a future weekday that is the estimated delivery date", () => {
    expect(found("It should arrive by Thursday.", "Thursday")).toBe(true);
    expect(found("It will be with you on Thursday.", "on Thursday")).toBe(true);
  });

  it("reads a past weekday as the last one before today", () => {
    expect(found("Your order shipped on Monday.", "on Monday")).toBe(true);
    expect(found("You placed it on Friday.", "on Friday")).toBe(true);
    expect(found("It was dispatched on Tuesday.", "on Tuesday")).toBe(false);
    expect(found("It shipped on Monday and should arrive by Thursday.", "Thursday")).toBe(true);
  });

  it("does not let the opening hours in a policy stand in for a delivery day", () => {
    // P-sections list "Monday to Friday" contact hours; they support "we reply on Monday", not a delivery day.
    const hours: SourceRef = { id: "P2.1", kind: "policy", label: "Policy P2.1: Contact", text: "Our team replies Monday to Friday, 9 am to 5 pm." };
    expect(checkDraft("Our team will reply on Monday.", [hours]).passed).toBe(true);
    expect(checkDraft("It will arrive on Monday.", [hours]).passed).toBe(false);
  });

  it("MSG-0069: confirms the NZ$49.00 missed-consult fee from the appointment sources", () => {
    const hine = (patientsData as unknown as Patient[]).find((p) => p.id === "PT-1040")!;
    const recs = selectRecords(hine, "appointment");
    const r = checkDraft("The NZ$49.00 charge on 18 September was the missed-consult fee [1].", recs);
    expect(r.facts.map((f) => [f.text, f.found])).toEqual([
      ["NZ$49.00", true],
      ["18 September", true],
    ]);
    expect(r.passed).toBe(true);
  });
});

// ---------------- round 4: the edit-path clinical gate, by category ----------------
// An agent's edited reply is checked with checkDraft(draft, []): every phrasing below must switch Send off with a plain
// reason, and every ordinary support sentence after them must still pass.

describe("check: the edit-path clinical gate blocks clinical content in any wording (review round 4)", () => {
  const byCategory: Record<string, string[]> = {
    "plays down a symptom": [
      "Don't worry about the headaches, they are nothing serious.",
      "The chest pain is probably nothing.",
      "Feeling paranoid is normal at first.",
      "Just ignore the rash for now.",
      "The chest tightness is probably just anxiety.",
      "Your shortness of breath will pass.",
      "That's normal.",
      "That's harmless.",
      "It will pass.",
      "Nothing serious, it should settle.",
      "Don't worry about the dizziness.",
      "Your heart racing is nothing to worry about.",
      "The rash is probably just a reaction to the heat.",
      "You're fine, the tingling is harmless.",
      "The paranoia is just your body adjusting.",
      "Seizures can happen, don't worry.",
      "Ignore the chest pain unless it gets worse.",
      "You'll be fine, the vomiting should stop soon.",
      "No need to worry about the palpitations.",
      "Taking more than prescribed now and then is fine.",
    ],
    "safety or addiction claim": [
      "You won't get addicted to it.",
      "Being natural, it can't hurt you.",
      "This strain won't make you high.",
      "It's not addictive.",
      "It isn't habit forming.",
      "There are no side effects.",
      "It's gentle on the stomach.",
    ],
    "product claim": [
      "This strain is really calming.",
      "The spray is gentler than the oil, you might prefer it.",
      "Our flower is stronger, so it will work better for you.",
      "It's really calming.",
      "It helps with sleep.",
      "It relieves pain.",
      "The indica is more relaxing than the sativa.",
      "I'd recommend the capsules instead.",
      "You could switch to the spray.",
      "The capsules work better for most people.",
      "This one is milder, so you might like it better.",
      "Being a sativa, it's quite uplifting.",
    ],
    "dosing advice": [
      "Use as much as you need.",
      "Increase it slowly until the pain goes away.",
      "There is no limit on how much you use.",
      "Try halving what you use at night.",
      "Use it every other day for now.",
      "Swap the morning capsule to the evening.",
      "Stay on your current amount and ride it out.",
      "Try halving it tonight.",
      "Double it if you need to.",
      "Double it if you need to, and your order ships tomorrow.",
      "Give it a rest for a few days.",
      "Leave it for a week.",
      "Space them out.",
      "Cut it back to once a day.",
      "Up it a little if you need.",
      "Split them across the day.",
      "Take them every other night.",
      "Move tonight's dose to the morning.",
      "Keep going with the same dose.",
      "Just ride it out for a few days.",
      "Have less of it in the evening.",
      "Give them a break over the weekend.",
    ],
    // Caught by the older rules or the patient lexicon in context; any clinical label is right.
    "any clinical label": [
      "It's safe with alcohol.",
      "Take less of them.",
      "Skip a dose.",
      "The nausea will go away on its own.",
      "Headaches are common at first, just push through.",
      "It's perfectly safe for you.",
      "It won't show up on a drug test.",
      "You can't overdose on it.",
      "It won't affect your driving.",
      "It won't make you drowsy.",
      "Wait and see if the headaches settle.",
      "It will stop the pain.",
    ],
  };
  const all = Object.values(byCategory).flat();

  it("covers at least 60 phrasings", () => {
    expect(all.length).toBeGreaterThanOrEqual(60);
  });

  for (const [label, drafts] of Object.entries(byCategory)) {
    for (const draft of drafts) {
      it(`blocks (${label}): ${draft}`, () => {
        const r = checkDraft(draft, []);
        expect(r.passed).toBe(false);
        expect(r.banned.length).toBeGreaterThan(0);
        expect(r.banned.every(isClinicalBan)).toBe(true);
        if (label !== "any clinical label") expect(r.banned[0].startsWith(`${label}: `)).toBe(true);
        expect(clinicianReason(r)).toMatch(/clinician/);
      });
    }
  }

  it("blocks the same wording inside a signed reply", () => {
    for (const phrase of ["Try halving it tonight.", "Double it if you need to.", "Give it a rest for a few days.", "Leave it for a week."]) {
      const r = checkDraft(`Hi Sam,\n\nThanks for your message. ${phrase}\n\nKind regards,\nJess`, []);
      expect(r.passed, phrase).toBe(false);
    }
  });

  it("blocks promotion: Our products are the best on the market.", () => {
    const r = checkDraft("Our products are the best on the market.", []);
    expect(r.banned).toEqual(["promotional wording: the best on the market"]);
    expect(r.passed).toBe(false);
  });

  it("gives each category a plain reason for the agent", () => {
    expect(clinicianReason(checkDraft("Don't worry about the headaches.", []))).toBe(
      "This plays down a symptom. Only a clinician can judge it: escalate it to a clinician.",
    );
    expect(clinicianReason(checkDraft("Your chest pain sounds worrying.", []))).toBe(
      "This mentions a serious symptom. Only a clinician replies about it: escalate it to a clinician.",
    );
    expect(clinicianReason(checkDraft("You won't get addicted to it.", []))).toBe(
      "Claims about safety or addiction are for a clinician: escalate it to a clinician.",
    );
    expect(clinicianReason(checkDraft("Double it if you need to.", []))).toBe("This reads as clinical advice: escalate it to a clinician.");
    expect(clinicianReason(checkDraft("This strain is really calming.", []))).toBe("Claims about what the product does are for a clinician.");
  });

  it("lets a sentence that only hands a serious symptom to a clinician or to emergency services through", () => {
    expect(checkDraft("A clinician will call you about the chest pain within the hour.", []).banned).toEqual([]);
    expect(checkDraft("If the swelling gets worse, call 000 straight away.", []).banned).toEqual([]);
    // A hand-over that also plays the symptom down is still blocked.
    expect(checkDraft("A clinician will call you, but the chest pain is probably nothing.", []).passed).toBe(false);
  });

  const ordinary = [
    "Your parcel is on its way and should arrive soon.",
    "I'm sorry your order arrived damaged.",
    "We have sent a replacement bottle.",
    "Please don't worry, we'll sort this out for you.",
    "No need to worry, your parcel is safe with the courier.",
    "Take a deep breath, we'll get this sorted.",
    "Please stay calm, a person from our team will call you today.",
    "I completely understand how frustrating this is.",
    "Thanks for letting us know, and sorry for the wait.",
    "Your refund will appear on your card in a few days.",
    "Your next delivery is booked.",
    "You can update your card details under Billing in your account.",
    "We will try your card again every other day until it goes through.",
    "We can split it across two deliveries if that helps.",
    "It's normal for tracking to take a day to update.",
    "Don't worry, your order is still on track.",
    "There's nothing to worry about with your payment, it went through.",
    "What a nightmare, I'm sorry the courier lost it.",
    "No sweat, happy to help.",
    "We've had more than usual demand this week.",
    "I've passed your question to a clinician, who will call you within the hour.",
    "If anything feels urgent, please call 000.",
    "Our team is happy to help you change your delivery address.",
    "You can pause your plan at any time.",
    "Please keep the parcel somewhere cool and dry.",
    "The courier will leave it with your neighbour.",
    "Leave it with me and I'll chase the courier today.",
    "Give us a call if you'd like to talk it through.",
    "The new bottles have a stronger seal.",
    "We recommend updating your card before the next billing date.",
    "It's safe with us, and we never share your details.",
    "Your parcel is safe with the neighbour.",
    "Try the link again in a few minutes.",
    "We have doubled up on packaging to stop leaks.",
    "Once your card is updated, the order will go out the same day.",
    "Thanks for your patience while we look into this.",
    "I'm so sorry to hear your dad passed away.",
    "Calm down is not what anyone wants to hear, so I'm sorry for the trouble.",
    "It's natural to feel frustrated when a parcel is late.",
    "It won't hurt to check your spam folder too.",
    "We'll cut back the number of reminder emails.",
    "The best way to reach us is by replying here.",
    // From a sample draft (MSG-0007): "change" is a noun here, not a switch of product.
    "A change to the products on a plan changes the price from the next billing date.",
  ];

  it("keeps at least 30 ordinary support sentences", () => {
    expect(ordinary.length).toBeGreaterThanOrEqual(30);
  });

  for (const draft of ordinary) {
    it(`allows ordinary support wording: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.banned).toEqual([]);
      expect(clinicianReason(r)).toBeNull();
    });
  }
});

describe("check: the edit-path gate, review round 5 (plural dismissals, second person, crisis thoughts, top-ups)", () => {
  const blocked: Record<string, string[]> = {
    "plays down a symptom": [
      "Headaches like that usually sort themselves out.",
      "I wouldn't be too concerned about the vomiting.",
      "I wouldn't worry about the dizziness.",
      "Nausea like that normally settles on its own.",
      "Your tummy upset tends to die down after a week.",
      "The swelling in your throat should go down soon.",
      "Having thoughts of ending things is common with stress.",
      "Wanting it all to be over is normal when you're grieving.",
    ],
    "safety or addiction claim": [
      "Being plant based, it has no nasty effects.",
      "Being herbal, it's very gentle.",
      "There are no real risks with it.",
    ],
    "dosing advice": [
      "Top it up in the afternoon if you need to.",
      "Top up with another capsule later.",
      "Just take a little extra when the pain flares.",
      "Add a bit more oil at night if it helps.",
      "Go back to what you were taking before.",
      "Go back to your old dose for now.",
      "Get back on the capsules when you feel ready.",
    ],
  };
  for (const [label, drafts] of Object.entries(blocked)) {
    for (const draft of drafts) {
      it(`blocks (${label}): ${draft}`, () => {
        const r = checkDraft(`Hi Sam,\n\n${draft}\n\nKind regards,\nJess`, []);
        expect(r.passed).toBe(false);
        expect(r.banned.length).toBeGreaterThan(0);
        expect(clinicianReason(r)).not.toBeNull();
      });
    }
  }

  it("a serious symptom in the second person always goes to a clinician", () => {
    expect(checkDraft("The swelling in your throat is a known effect.", []).passed).toBe(false);
  });

  const ordinary = [
    "Your refund should clear soon.",
    "You can top up your account balance from the app.",
    "We've added a little extra padding to the box.",
    "Go back to the home page and tap Orders.",
    "The delays should die down soon now the backlog is cleared.",
    "I wouldn't worry about the parcel, it's safe at the depot.",
    "You can switch back to the old plan at any time.",
    "There's no risk to your card details.",
    "Take a little more time to look over the invoice if you need.",
    "Please have some patience while the courier catches up.",
    "The queue should go down soon.",
    "Things usually sort themselves out with the courier.",
    "I'm sorry to hear about your dad, and I hope things get easier.",
    "You can end it at any time from your account settings.",
  ];
  for (const draft of ordinary) {
    it(`allows ordinary support wording: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.banned).toEqual([]);
      expect(clinicianReason(r)).toBeNull();
    });
  }
});

// ---------------- red-team round 1: paraphrases by category (core#4, core#7, core#10) ----------------

describe("check: clinical paraphrases are blocked by category (red-team round 1)", () => {
  const clinical: [string, string[]][] = [
    ["crisis language", [
      "Lots of people feel like giving up now and then.", "Please don't do anything stupid.", "You have so much to live for.",
      "I know you feel hopeless, but it will get better.", "You'll get through this, hang in there.", "You're not a burden.",
      "Everyone has low days.", "Feeling a bit down on the oil is common.", "It's normal to feel flat for a while.",
    ]],
    ["plays down a symptom", [
      "A dry cough like that is nothing unusual.", "The tingling in your fingers is just the capsules settling in.",
      "Yellow eyes can happen, just keep an eye on it.", "Losing your appetite is pretty standard at first.",
      "He'll be right once he sleeps it off.", "You probably just need an early night.", "Try a lie down and some water.",
    ]],
    ["serious symptom", ["The tight feeling in your chest is probably just a cold."]],
    ["other medicines, alcohol, pregnancy", [
      "For the swelling, an antihistamine might help.", "An antihistamine might help with the rash.",
      "Have a glass of wine if you like, it won't hurt.", "Beer is fine with the capsules.", "It's fine to breastfeed on it.",
      "Paracetamol is fine alongside the oil.", "Try some melatonin for the sleep.", "Milk you express is fine for the baby.",
    ]],
    ["dosing advice", [
      "Take it more often.", "Use it less often.", "Use it more often if it isn't working.", "Go up by a drop each night.",
      "You can take the next one sooner.", "Bump it up a little.", "Cut it back to one a night.",
      "Leave an hour between the oil and your tablets.", "Hold it under your tongue.", "Don't change how much you take.",
      "Go easy on the oil tonight.", "Stop for a week and see.", "Just stop when you feel better.",
    ]],
    ["product claim", [
      "Our indica will help you sleep.", "Sativa is better for daytime.", "Most patients find the spray much better.",
      "The spray lasts longer than the oil.", "The capsules kick in faster.", "The gummies work quicker.",
      "The blend is your best bet for sleep.", "People swear by the spray for pain.", "It does wonders for anxiety.",
      "This will sort out your back pain.", "You'll notice a real difference in a fortnight.", "I promise the oil will help.",
    ]],
    ["safety claim", [
      "It's safe for older patients.", "It's okay to use once expired.", "The spray isn't harmful to cats.",
      "The oil won't have caused the rash.", "It's nothing to do with the capsules.", "The safest thing is to throw it out.",
    ]],
    ["clinical acts: sharing, swaps and triage", [
      "You can share a few with your husband.", "Your wife can borrow some of yours.", "We've switched you over to the spray.",
      "I've changed your capsules to the oil.", "No need to see a doctor about that.", "That can wait until your next review.",
      "See your GP about the dizziness.", "Mention the rash to your pharmacist.",
    ]],
  ];
  for (const [category, drafts] of clinical) {
    for (const draft of drafts) {
      it(`blocks (${category}): ${draft}`, () => {
        const r = checkDraft(draft, []);
        expect(r.passed).toBe(false);
        expect(clinicianReason(r)).not.toBeNull();
      });
    }
  }

  it("says why crisis language needs a clinician", () => {
    expect(clinicianReason(checkDraft("Hang in there, you have so much to live for.", []))).toMatch(/crisis/);
  });
});

describe("check: policy breaches are blocked for a rewrite, not a clinician (red-team round 1)", () => {
  const breaches: [string, RegExp][] = [
    ["Reply with your card number and I'll add it.", /card details/],
    ["Thanks, I've added your new card 4000 0566 5566 5556.", /card number/],
    ["What's your password?", /password/],
    ["Can you send the verification code?", /password/],
    ["Your refund has gone to the new card.", /original card/],
    ["I've applied a promo code for you.", /discount codes/],
    ["We've deleted all your data from our records.", /privacy officer/],
    ["I told your flatmate the parcel is from the clinic.", /not listed/],
    ["Your new email is [EMAIL].", /placeholder/],
  ];
  for (const [draft, reason] of breaches) {
    it(`blocks: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.passed).toBe(false);
      expect(clinicianReason(r)).toBeNull();
      expect(policyReason(r)).toMatch(reason);
    });
  }

  it("never shows a full card number back in the blocked list", () => {
    const r = checkDraft("Thanks, I've added your new card 4000 0566 5566 5556.", []);
    expect(r.banned.join(" ")).not.toMatch(/4000/);
    expect(r.banned.join(" ")).toMatch(/ending 5556/);
  });
});

describe("check: ordinary support wording still passes (red-team round 1)", () => {
  const ordinary = [
    "Your swelling question has gone to a clinician, who will call you today.", "We'll send your order more often if you'd like.",
    "Thanks for your patience while we sort this out.", "No problem at all, I've updated it for you.",
    "Please use the newest reset link, the older ones won't work.", "Please don't send card details here; add them under Billing in the app.",
    "We never ask for your password.", "We don't have discount codes, sorry.", "Refunds only go back to the original card.",
    "I've passed your deletion request to our privacy officer.", "Brenda can take a message that we called.",
    "I'll flag it with the team today.", "I'll raise this with the courier.", "It'll cost a bit more for express post.",
    "I hope you feel better soon.", "Sorry, I know the feeling with couriers.", "We'll keep things as they are on your plan for now.",
    "It's fine to use your work address.", "The price will go up by the amount in the notice email.",
    "Your oil is packed and will go out on the next courier run.", "If you feel unsafe at any point, please call 000.",
    "Please call Lifeline on 13 11 14 if you need to talk to someone now.", "The new app update should fix the log out problem.",
    "We can send the next order to your sister's place instead.", "You'll get an email once it ships.",
  ];
  for (const draft of ordinary) {
    it(`allows: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.banned).toEqual([]);
      expect(clinicianReason(r)).toBeNull();
      expect(policyReason(r)).toBeNull();
    });
  }
});

describe("check: red-team round 2, a hand-over excuses only its own clause", () => {
  const blocked = [
    "Our clinician will call, but the chest pain is likely just muscular.",
    "Our clinician will call, but the chest tightness is likely anxiety.",
    "A clinician will call you; until then take an antihistamine.",
    "A clinician will be in touch today; in the meantime, take two paracetamol for the pain.",
    "Pop a Panadol and a clinician will call you this afternoon.",
    "Our nurse will call; ibuprofen is what most people use for the headaches.",
    "A pharmacist will be in touch; meanwhile a glass of wine with dinner is no issue.",
    "Our clinician is happy for you to drink alcohol.",
    "Our doctors are happy for you to keep having a glass of wine each night.",
    "Your pharmacist will confirm, but alcohol and cannabis mix well for most people.",
    "Your GP can prescribe you melatonin for the sleep.",
  ];
  for (const draft of blocked) {
    it(`blocks for a clinician: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.passed).toBe(false);
      expect(clinicianReason(r)).not.toBeNull();
    });
  }
  const handovers = [
    "A clinician will call you about the rash and the headaches today.",
    "I have passed this to our clinical team, so they will contact you about the dizziness.",
    "A clinician will call you; in the meantime, please keep your phone nearby.",
    "A nurse will call you back this afternoon to talk about the side effects.",
    "Please call 000 now if the swelling gets worse, and a clinician will follow up.",
    "Our support team can't advise on how much to take, so a clinician will reply to your question.",
    "Our clinician will be in touch, and they can talk you through your options.",
  ];
  for (const draft of handovers) {
    it(`lets a hand-over through: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.banned).toEqual([]);
      expect(clinicianReason(r)).toBeNull();
    });
  }
});

describe("check: red-team round 2, symptoms played down or made to sound ordinary", () => {
  const drafts = [
    "Lots of patients feel a bit dizzy for the first week.",
    "Night sweats are a known effect in the first fortnight.",
    "Dizziness in the first week is part of the process.",
    "Feeling drowsy the next morning is a known and mild effect.",
    "Headaches are a recognised effect and nothing more.",
    "A dry mouth is one of the most frequent reactions and fades quickly.",
    "The nausea is simply your system adjusting.",
    "The shakes will be gone by the weekend.",
    "The spacey feeling tends to fade after a few days.",
    "We see this a lot and it always settles.",
    "Low energy in week one is completely par for the course.",
    "Honestly, the dizziness is the least of your worries.",
    "A bit of dizziness is a small price to pay for better sleep.",
    "Anxiety usually lifts after a little while.",
    "Drink lots of water and you'll feel right as rain.",
  ];
  for (const draft of drafts) {
    it(`blocks: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.passed).toBe(false);
      expect(clinicianReason(r)).not.toBeNull();
    });
  }
});

describe("check: red-team round 2, product, safety and impairment claims", () => {
  const drafts = [
    "Most people sleep through the night soon after starting.",
    "Most patients sleep better from the first night.",
    "People with arthritis tend to get great results.",
    "Patients report less pain after a fortnight on the capsules.",
    "Your pain should be much easier to manage from next week.",
    "The morning stiffness should ease once you're settled on the capsules.",
    "You'll be sleeping like a baby.",
    "Most people barely notice any effect apart from better sleep.",
    "You won't feel any different apart from calmer.",
    "Nobody gets hooked, promise.",
    "It's not the kind of medicine people get dependent on.",
    "There's zero chance of withdrawal.",
    "You can stop any time without cravings.",
    "The capsules are very well tolerated.",
    "This product has an excellent safety profile.",
    "Our oil is very gentle on the body.",
    "It's non-psychoactive so you'll be fine at work.",
    "Cannabis oil is non-intoxicating at this strength.",
    "It is a very mild medicine.",
    "Thousands of Australians use medicinal cannabis every day without trouble.",
    "It plays nicely with most prescription meds.",
    "You'll be okay to operate the forklift the next morning.",
    "Your GP will be pleased, as the oil is good for blood pressure.",
  ];
  for (const draft of drafts) {
    it(`blocks: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.passed).toBe(false);
      expect(clinicianReason(r)).not.toBeNull();
    });
  }
});

describe("check: red-team round 2, a negation counts only in its own clause", () => {
  const cases: [string, string][] = [
    ["If the app won't load, just reply with your card number and expiry and I'll process it.", "asks for card details"],
    ["If you can't log in, tell me your password and I'll check the account for you.", "asks for a password"],
    ["Sorry we can't do it sooner, but all your records will be permanently deleted.", "promises a deletion"],
    ["If you don't have the app, text the 16 digits on the front of your card to this number.", "asks for card details"],
    ["Your card 4111.1111.1111.1111 has been updated.", "repeats a card number"],
  ];
  for (const [draft, label] of cases) {
    it(`blocks (${label}): ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.passed).toBe(false);
      expect(r.banned.some((b) => b.startsWith(`${label}:`))).toBe(true);
      expect(clinicianReason(r)).toBeNull();
      expect(r.banned.join(" ")).not.toMatch(/4111\.1111/);
    });
  }
  const allowed = [
    "Refunds can't go to a new or different card, only back to the original one.",
    "We will never ask you to send your password or card number.",
    "Please don't reply with your card details; update them under Billing in the app.",
    "If you can't log in, use the newest reset link we sent.",
  ];
  for (const draft of allowed) {
    it(`allows: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.banned).toEqual([]);
      expect(policyReason(r)).toBeNull();
    });
  }
});

describe("check: red-team round 2, ordinary support wording still passes", () => {
  const ordinary = [
    "Sorry it's been a headache sorting this out.",
    "I know the last few orders have been a headache.",
    "Sorry it has been a headache getting the tracking to load.",
    "Your refund timing is dependent on your bank.",
    "We have hooked up a new courier for your area.",
    "I hope the move goes well.",
    "You can stop the texts any time from the app.",
    "Our usual response time is one business day.",
    "Most patients find the app easier to use now.",
    "A pharmacist will check your order, and it will ship once approved.",
    "Thanks for your patience, the price change has been a pain for lots of people.",
    "The good news is the delay should be over by Friday.",
    "Your doctor has approved the new script, and your order will ship soon.",
    "Most people choose the monthly plan because it is simpler to manage.",
    "It is a known issue with the app and our team is fixing it.",
    "We see this a lot with bank holds and it always settles within a few days.",
  ];
  for (const draft of ordinary) {
    it(`allows: ${draft}`, () => {
      const r = checkDraft(draft, []);
      expect(r.banned).toEqual([]);
      expect(clinicianReason(r)).toBeNull();
      expect(policyReason(r)).toBeNull();
    });
  }
});
