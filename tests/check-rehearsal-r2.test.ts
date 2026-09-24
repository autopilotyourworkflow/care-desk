/**
 * Rehearsal round 2 (checker fix P3, plus the round-2 "keep an eye on" loose end). Every sentence marked "round 2" is
 * the real draft sentence from cc-run/r2 that the checker blocked; the slice reviewers judged each draft fine to send.
 * Next to each one sit the clinical phrasings that must still be blocked, so the fix loosens nothing clinical.
 * Fictional data only.
 */
import { describe, it, expect } from "vitest";
import { checkDraft } from "@/lib/pipeline/check";

const banned = (text: string) => checkDraft(text, []).banned;

// ---------- P3a: "if you miss it" about a delivery, not a dose ----------

describe("rehearsal r2, P3a: 'miss it' about a parcel is not missed-dose advice", () => {
  const passes = [
    // MSG-0097, round 2
    "If you miss it, Courierline holds the parcel at the local depot for 5 business days, and you can book a free redelivery or collect it using the tracking link [4].",
    // MSG-0184, round 2
    "If you miss it, Courierline leaves a card and holds it at the local depot for 5 business days, and you can book a free redelivery or collect it with photo ID using the tracking link [3].",
    "If you miss them, the courier leaves a card.",
    "If you miss it, the delivery can be rebooked from the tracking link.",
  ];
  for (const text of passes) it(`passes: ${text}`, () => expect(banned(text)).toEqual([]));

  it("passes the whole MSG-0097 draft", () => {
    const draft =
      "Yes, [FIRST_NAME], your next billing date is 7 October 2026, and repeat orders are placed on the billing date and usually dispatched 1 to 2 business days later [2][5]. " +
      "Delivery in mainland UK takes 1 to 2 business days from dispatch, and it needs a signature [3]. " +
      "If you miss it, Courierline holds the parcel at the local depot for 5 business days, and you can book a free redelivery or collect it using the tracking link [4].\n[AGENT_NAME]";
    expect(banned(draft)).toEqual([]);
  });

  it("passes the whole MSG-0184 draft", () => {
    const draft =
      "[FIRST_NAME], I cannot promise a delivery day, but order ORD-20052 has an estimated delivery of 23 September 2026, which is the last day of its delivery window [1][4]. " +
      "It needs a signature, so someone will need to be there to sign for it [3]. " +
      "If you miss it, Courierline leaves a card and holds it at the local depot for 5 business days, and you can book a free redelivery or collect it with photo ID using the tracking link [3].\n[AGENT_NAME]";
    expect(banned(draft)).toEqual([]);
  });

  const blocks = [
    "If you miss it tonight, take it in the morning.",
    "Skip the capsules.",
    "If you miss it, take it when you remember.",
    "If you miss it, just skip the capsules until the parcel arrives.",
    "If you miss them, double up the next day when the courier comes.",
    "If you miss the oil, the courier holds the parcel at the depot.",
    "If you miss it tonight, the courier can redeliver tomorrow.",
    "If you miss it, you may feel dizzy until the parcel arrives.",
  ];
  for (const text of blocks) it(`still blocks: ${text}`, () => expect(banned(text).length).toBeGreaterThan(0));

  it("still blocks 'miss it' when the sentence before names the medicine", () => {
    expect(banned("Take one capsule at night. If you miss it, the courier holds the parcel.").some((b) => /miss it/i.test(b))).toBe(true);
  });
});

// ---------- P3b: "the date it takes effect" about a price change ----------

describe("rehearsal r2, P3b: 'it takes effect' about a price, a charge or a notice is not a product claim", () => {
  const passes = [
    // MSG-0023, round 2
    "A new price applies from the first billing date on or after the date it takes effect, so your charge on 8 September 2026 was NZ$162 [1][5].",
    "The date it takes effect is 1 October 2026.",
    "The new fee takes effect from your next billing date.",
    // Still passes, pinned in check-redteam.test.ts: tracking, not the medicine.
    "Give it a day or two and the tracking should kick in.",
  ];
  for (const text of passes) it(`passes: ${text}`, () => expect(banned(text)).toEqual([]));

  it("passes the whole MSG-0023 draft", () => {
    const draft =
      "Hi [FIRST_NAME],\n\nI understand the higher charge was a surprise. It is not a mistake: the monthly plan price in New Zealand changed from NZ$149 to NZ$162 from 1 September 2026 [5]. " +
      "A new price applies from the first billing date on or after the date it takes effect, so your charge on 8 September 2026 was NZ$162 [1][5].\n\n" +
      "We give at least 30 days' notice by email, and this change was emailed to patients on 31 July 2026 [5]. The team will look into why that email may not have reached you. " +
      "Your next billing date is 8 October 2026, at NZ$162 per month [4].\n\nKind regards,\n[AGENT_NAME]";
    expect(banned(draft)).toEqual([]);
  });

  const blocks = [
    "Give it two weeks and it takes effect.",
    "Give it a couple of weeks and it should start working.",
    "Your new price date is set; give it two weeks and it takes effect.",
    "Once your billing date passes, it should kick in within a few days.",
    "After your first charge, it takes effect on your sleep within a week.",
    // A medicine word keeps it blocked even with a tech or money word beside it.
    "Once your oil order arrives, give it two weeks and it takes effect.",
    "The price is the same, and the capsules should start working in a few days.",
  ];
  for (const text of blocks) it(`still blocks: ${text}`, () => expect(banned(text).length).toBeGreaterThan(0));

  // Round 2 widening: an onset claim with the medicine as the subject passed before (only "it", "they" and "them" were
  // read as subjects).
  const medicineSubject = [
    "The capsules should start working in a few days.",
    "The oil takes effect within an hour.",
    "Your treatment should kick in soon.",
    "The capsules usually do the trick.",
    "The spray should make a real difference to you.",
  ];
  for (const text of medicineSubject) {
    it(`blocks a medicine-subject onset claim: ${text}`, () => expect(banned(text).some((b) => b.startsWith("product claim:"))).toBe(true));
  }

  const adminSubject = [
    "The new oil price takes effect from 1 October 2026.",
    "The oil price rises on 1 October, the date it takes effect.",
    "The product swap takes effect from your next order.",
    "The discount code should start working within an hour.",
    "Your treatment plan change takes effect from your next billing date.",
  ];
  for (const text of adminSubject) it(`passes a price or plan sentence: ${text}`, () => expect(banned(text)).toEqual([]));

  it("still blocks a dose change taking effect", () => {
    expect(banned("Your dose change takes effect from your next order.").length).toBeGreaterThan(0);
  });
});

// ---------- P3c: "if you would like" is an offer, not a product claim ----------

describe("rehearsal r2, P3c: 'if you would like' is an offer, not 'you would like the product'", () => {
  const passes = [
    // MSG-0077, round 2
    "We cannot add products to an order, but the team can pass a request to a clinician if you would like [4].",
    "If you'd like, the team can pass a request for other products to a clinician.",
    "Whenever you would like to change products, a clinician needs to approve it.",
  ];
  for (const text of passes) it(`passes: ${text}`, () => expect(banned(text)).toEqual([]));

  it("passes the whole MSG-0077 draft", () => {
    const draft =
      "[FIRST_NAME], your order ORD-20036 was shipped with Courierline on 17 September 2026, tracking CD1489195436, with an estimated delivery of 22 September 2026 [1]. " +
      "The tracking link is in your dispatch email [3]. We cannot add products to an order, but the team can pass a request to a clinician if you would like [4].\n[AGENT_NAME]";
    expect(banned(draft)).toEqual([]);
  });

  const blocks = [
    // "You'd like" with no space before 'd passed before round 2; it now blocks.
    "You'd like the capsules better.",
    "You would like the capsules better.",
    "You'd prefer the spray.",
    "You might enjoy the gummies more.",
    "I think you would like the oil.",
    "If you'd like to try the capsules instead, let us know.",
  ];
  for (const text of blocks) it(`still blocks: ${text}`, () => expect(banned(text).length).toBeGreaterThan(0));
});

// ---------- round-2 loose end: "keep an eye on" how the medicine makes you feel ----------

describe("rehearsal r2: 'keep an eye on' the medicine's effect is clinical, even with a parcel named", () => {
  const blocks = [
    // Passed after round 2 (round-2 retrieval fixer's note): a medicine word is present.
    "Keep an eye on how the oil makes you feel until the parcel arrives.",
    "Keep an eye on how the capsules affect your sleep.",
    "Keep an eye on the parcel and how you feel.",
    "Keep an eye on the oil while you wait for the courier.",
    // Still blocked, pinned in round 1.
    "Pale poo can happen with the capsules, just keep an eye on it.",
    "Keep an eye on the parcel and your headaches.",
  ];
  for (const text of blocks) it(`blocks: ${text}`, () => expect(banned(text).length).toBeGreaterThan(0));

  it("labels the loose-end sentence as clinical advice", () => {
    expect(banned("Keep an eye on how the oil makes you feel until the parcel arrives.")).toEqual([
      "clinical advice: Keep an eye on how the oil makes you feel until the parcel arrives",
    ]);
  });

  const passes = [
    "In the meantime, you can keep an eye on it with tracking number CD7270741424 [1].",
    "You can keep an eye on your parcel with the tracking link in your dispatch email.",
    "Keep an eye on your oil order with the tracking link.",
  ];
  for (const text of passes) it(`passes: ${text}`, () => expect(banned(text)).toEqual([]));
});
