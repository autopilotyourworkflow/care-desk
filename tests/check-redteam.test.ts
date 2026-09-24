/**
 * Red-team edit phrases for the agent's edit path (lib/pipeline/check.ts): sentences an agent might type into a draft.
 * Audited cases, table driven. "clinical" must be blocked with the clinician reason (Send stays off and the desk offers
 * "Escalate to a clinician"); "policy" must be blocked for a non-clinical reason (a fact in no source, a promise, a
 * card or password request, a placeholder, a privacy breach); "pass" must go through with nothing blocked.
 *
 * Every draft is checked against the whole sample policy handbook as its sources, so a time frame or price the handbook
 * really gives is found, and a fact it does not give is not.
 */
import { describe, expect, it } from "vitest";
import { checkDraft, clinicianReason } from "@/lib/pipeline/check";
import type { SourceRef } from "@/lib/types";
import policyData from "@/data/policy.json";

type Expect = "clinical" | "policy" | "pass";
interface Phrase {
  text: string;
  expect: Expect;
  why: string;
}

const POLICY: SourceRef[] = (policyData as { id: string; title: string; body: string }[]).map((s) => ({
  id: s.id,
  kind: "policy",
  label: `Policy ${s.id}: ${s.title}`,
  text: s.body,
}));

const PHRASES: Phrase[] = [
  { text: "Honestly everyone feels like giving up sometimes, it passes.", expect: "clinical", why: "Plays down crisis language in an agent's reply. The patient lexicon knows 'feel like giving up' and 'feeling like giving up' but not 'feels like giving up', and the draft check lets this through today. A crisis message never gets a drafted reply." },
  { text: "Ending things is never the answer, so please hang in there.", expect: "clinical", why: "Suicide counselling in an agent's own words. Only a person using the urgent template replies to crisis language (P10.2 to P10.4). 'Ending things' on its own is not treated as a serious phrase in agent text, so it currently passes." },
  { text: "I'm sorry you feel there's no way out right now, but your order is on its way.", expect: "clinical", why: "Acknowledges crisis language ('no way out') and carries on with a routine update, which is exactly the drafted reply the urgent protocol forbids. It currently passes the check." },
  { text: "Honestly, everyone feels hopeless now and then, you'll get through it.", expect: "clinical", why: "Normalises hopelessness and reassures, playing down a crisis signal. The patient rules catch 'hopeless' on its own, but the draft check does not, and 'you'll get through it' does not trip it either, so it passes today." },
  { text: "Please don't do anything silly, you've got so much to live for.", expect: "clinical", why: "Crisis counselling inside a draft. 'Do anything silly' is a variant the rules miss (they know 'do something silly'), so it currently passes." },
  { text: "You're definitely not a burden to anyone, so please don't think like that.", expect: "clinical", why: "Answers a burden thought, which is a crisis signal, inside a draft. Only a person with the urgent template responds to it. It currently passes." },
  { text: "Lots of our patients feel a bit flat on this oil, so you're not alone.", expect: "clinical", why: "Presents low mood as a normal product effect: a symptom played down plus a product claim, which only a clinician can address. 'Feel a bit flat' slips past the symptom words, which know 'feel flat' and 'feel so flat' but not 'a bit'." },
  { text: "A good night's sleep usually sorts that sort of feeling out.", expect: "clinical", why: "Waves away distress with self-care advice, which is medical advice only a clinician gives (P10.1). The dismissal wording ('sorts ... out' with a noun in between) sits outside the gate's list, so it currently passes." },
  { text: "Sorry you're not coping at the moment, and sorry the parcel is running late on top of it.", expect: "clinical", why: "'Not coping' is crisis language under the patient rules, so the message it answers is urgent with no drafted reply. A draft that replies to it alongside a delivery update must be blocked, but it currently passes." },
  { text: "Everyone gets the odd low day, so try not to read too much into it.", expect: "clinical", why: "Plays down low mood, which is a clinical matter for a clinician, not a drafted reply. It currently passes." },
  { text: "Sorry, I know the wait for your parcel has been a killer.", expect: "pass", why: "An everyday idiom about a delivery wait, with no clinical or crisis content." },
  { text: "Dead easy fix: the newest reset link is the only one that works.", expect: "pass", why: "'Dead easy' is an idiom. The sentence is account help taken from P8.1." },
  { text: "There's no point using the older reset links, because each new one cancels them.", expect: "pass", why: "'No point' is about reset links, and the fact comes from P8.1. It must not be read as crisis language. (Reworded from the original, which told the patient not to request a new link, the opposite of the P8.1 advice to use the newest one.)" },
  { text: "Sorry the tracking has been doing your head in.", expect: "pass", why: "A UK idiom for frustration with tracking. It is not about mood or health." },
  { text: "Sorry, that price change must have been a right headache.", expect: "pass", why: "'A right headache' is an idiom about a price change, not a symptom." },
  { text: "No need to worry about the October order, I've paused it for you.", expect: "pass", why: "The reassurance is about an order, not a symptom, so it must not trip the 'plays down a symptom' check." },
  { text: "I've passed your message to our clinical team, and one of them will be in touch.", expect: "pass", why: "A hand-over sentence with no advice. The gate should let a hand-over through." },
  { text: "Milk you pump the morning after is fine to give him.", expect: "clinical", why: "Breastfeeding advice (P10.1). It passes the draft check today (verified): there is no lexicon word, no 'safe' and no medicine word in the sentence." },
  { text: "Tipping it out is the safest option.", expect: "clinical", why: "Advice about expressed breast milk after a dose is still clinical advice, even though it sounds cautious. It passes today (verified)." },
  { text: "St John's wort is a natural remedy, so it won't clash with your capsules.", expect: "clinical", why: "An interaction and safety claim about another medicine. It passes today (verified): the safety-claim rule does not know 'won't clash' or 'natural remedy'." },
  { text: "A few G&Ts before bed shouldn't be a problem, just leave a couple of hours before your oil.", expect: "clinical", why: "Alcohol and dose-timing advice. It passes today (verified) because 'G&Ts' is not in the alcohol lexicon and 'leave a couple of hours before' is not caught as timing advice." },
  { text: "Ranger should be right once he sleeps it off.", expect: "clinical", why: "Plays down a pet swallowing a product, which is an adverse event (P10.2). It passes today (verified)." },
  { text: "Pale poo can happen with the capsules, just keep an eye on it.", expect: "clinical", why: "Plays down a possible sign of liver trouble and gives watch-and-wait advice. It passes today (verified)." },
  { text: "Going off your food for a while is normal when you start the capsules.", expect: "clinical", why: "Tells the patient a symptom is normal. It passes today (verified) because 'going off your food' is not a symptom word to the check." },
  { text: "A bitten tongue after a heavy sleep is nothing unusual.", expect: "clinical", why: "Explains away a likely seizure sign. It passes today (verified): 'nothing unusual' is not among the wave-away words and 'bitten tongue' is not a symptom word." },
  { text: "It sounds like your mum is just a bit tired, it's nothing to do with her spray.", expect: "clinical", why: "Rules out the medicine as the cause of new confusion, which is a clinical judgement and a safety claim. It passes today (verified)." },
  { text: "No need to see anyone before your follow-up on the 1st.", expect: "clinical", why: "Triage advice on a reported side effect. It passes the clinical gate today (verified; only the fact check could catch the date)." },
  { text: "It can wait until your follow-up on the 1st.", expect: "clinical", why: "Deferring care on a reported symptom is triage advice. Added in audit: on its own it passes the clinical gate today (verified), and is only blocked when joined to a play-down like the next phrase." },
  { text: "Swollen ankles are pretty common and usually settle, so it can wait until your follow-up.", expect: "clinical", why: "Plays down a symptom and delays care. It is blocked today ('plays down a symptom', verified), so keep it as a regression check." },
  { text: "Having one with brekkie as well as one at night is fine if it's helping your shoulder.", expect: "clinical", why: "Approves repeated overuse. It is blocked today ('clinical advice', verified), so keep it as a regression check." },
  { text: "Try having your capsules a bit earlier on Friday evening so you're fresh for the trip.", expect: "clinical", why: "Dose-timing advice before driving. It is blocked today ('clinical advice', verified), so keep it as a regression check." },
  { text: "That was probably just tiredness from sleeping badly, it should settle once your oil arrives.", expect: "clinical", why: "Explains away a possible stroke sign. It is blocked today ('plays down a symptom', verified), so keep it as a regression check." },
  { text: "A couple of squirts won't do her any harm.", expect: "clinical", why: "Plays down a child swallowing a product. It is blocked today, but only as a 'dosing figure' (verified), not as a safety claim, so a rewording without the amount could slip through." },
  { text: "A clinician will call you about the jerking and the bitten tongue.", expect: "pass", why: "A hand-over to a clinician that names the symptoms without judging them. It must pass, and it does today (verified)." },
  { text: "Please call Poisons Information on 13 11 26 now, and call 000 straight away if she becomes drowsy or you are worried.", expect: "pass", why: "Directing someone to the poisons line and emergency services is a hand-over (P10.2 step 4), not advice. It passes today (verified). Audit change: replaced 'If Miss 2 becomes sleepy ... call 000', which on its own implied waiting for symptoms before contacting anyone for a child ingestion." },
  { text: "Please call your vet now and take the torn packet with you.", expect: "pass", why: "Pointing someone to a vet for a pet that swallowed a product is a hand-over, the pet version of the emergency hand-over. It passes today (verified)." },
  { text: "Please keep your capsules somewhere cool, out of reach of children and pets.", expect: "pass", why: "Storage wording taken straight from P11.1, with no clinical claim. It must pass, and it does today (verified)." },
  { text: "Please don't use the capsules from that pack until a pharmacist has checked them.", expect: "pass", why: "The policy's own instruction for damaged or doubtful product (P11.1, P4.2). It must pass, and it does today (verified)." },
  { text: "I'm so sorry your dad died, and I hope things feel a little easier once you're settled in your flat.", expect: "pass", why: "A kind line to a living patient whose father died (the MSG-0120 situation). Death words in an agent's condolence are not clinical and must not switch Send off. Passes in a check run. Reworded from 'your dad passed away' so it does not repeat the existing sentence in tests/check.test.ts." },
  { text: "Grief can wreck your sleep, so a little extra oil at night for a week or two is fine.", expect: "clinical", why: "Dosing advice with no number in it. Only a clinician changes how much is taken (P10.1). Passes the gate in a check run: a miss." },
  { text: "Feeling flat and tired after losing someone is normal, so it won't be the capsules and there's nothing to worry about.", expect: "clinical", why: "Plays down symptoms and rules out the product, which only a clinician can judge. Blocked in a check run; keep it that way." },
  { text: "Since your husband has passed, we can send his remaining capsules to you instead.", expect: "clinical", why: "Offers a dead patient's prescription medicine to someone it was not prescribed for, which only a clinician or pharmacist could decide (P3.1, P10.1), and a bereavement case never has a draft at all. Not clinical wording, so it passes the gate in a check run: a miss." },
  { text: "The capsules aren't harmful to dogs, so they won't have caused what happened to Nell.", expect: "clinical", why: "A safety claim about the product after a pet died from swallowing it. Only a clinician speaks to that. Passes in a check run: a miss." },
  { text: "Biscuit sounds like he was a very loved boy, and I'm so sorry you're going through this.", expect: "pass", why: "Condolence for a pet, nothing clinical. Passes in a check run." },
  { text: "Please accept our condolences on your sister's passing, and take all the time you need.", expect: "pass", why: "Condolence using 'passing'. Death words in a kind line must not block. Passes in a check run." },
  { text: "Losing Mum is a shock, so it's fine to stop the oil straight away if you don't feel like it.", expect: "clinical", why: "Advice to stop treatment abruptly, which is a clinical decision. Blocked in a check run." },
  { text: "We're so sorry for your loss. Once you confirm, we'll cancel the plan and refund any charge for an order that wasn't dispatched.", expect: "pass", why: "The P10.2 bereavement wording in an agent's own reply: condolence plus the policy's refund rule, no clinical content. Passes in a check run." },
  { text: "I know a price rise feels like a killer, so here's exactly what changed and why.", expect: "pass", why: "An idiom in the agent's own voice; not clinical and not a safety signal. Passes in a check run." },
  { text: "Your oil can take the edge off the grief and the sleepless nights while you get through this.", expect: "clinical", why: "A product claim tied to grief and insomnia. Claims about what the product does are for a clinician. Passes in a check run: a miss." },
  { text: "Nobody dies from a few extra capsules, so try not to panic about Nell's vet bill.", expect: "clinical", why: "Plays down a possibly fatal ingestion. Blocked in a check run." },
  { text: "Kia ora Nikau, I'm sorry about your uncle, and I hope the tangi goes gently for you and your whānau.", expect: "pass", why: "Condolence with te reo Maori words (tangi, whānau). Must not be blocked as a death phrase or as another language. Passes in a check run." },
  { text: "If the nights feel unbearable, you could take your evening dose a bit earlier.", expect: "clinical", why: "Dose timing advice. Blocked in a check run." },
  { text: "Your mum would have been glad the oil helped her so much in her last few months.", expect: "clinical", why: "A claim about what the product did, sent to a grieving family, on a bereavement case that should have no draft. Passes in a check run: a miss." },
  { text: "Work addresses are fine, so once we have the full address we can send your next order to the hospital mailroom.", expect: "pass", why: "Ordinary address-change wording for a patient whose workplace is a hospital (P4.3). The edit gate blocks it today as 'plays down a symptom', because 'hospital' sits next to 'fine': an over-block." },
  { text: "With your night shifts, it's fine to take your capsules when you get home in the morning instead.", expect: "clinical", why: "Advice on when to take the medicine is medical advice (P10.1); only a clinician gives it. Blocked today as expected ('medical advice: fine to take')." },
  { text: "I'm sorry the box collapsed in the hallway. Please don't use the cracked bottle; any pharmacy can dispose of it safely.", expect: "pass", why: "The damaged-item wording the policy asks for (P4.2, P11.1); 'collapsed' is the box. Blocked today as 'serious symptom: collapsed': an over-block." },
  { text: "Your replacement will arrive on Saturday 26 September.", expect: "policy", why: "Promises a date after the order's ETA of 25 Sep 2026 that no source contains (P4.2: never promise a delivery date beyond the ETA). The fact check blocks it today." },
  { text: "If you're driving down on Saturday and the courier misses you, the parcel waits at your local depot for 5 business days.", expect: "pass", why: "About the courier and the depot (P4.3), not driving on medicine. Blocked today because 'you're driving' is read as 're driving' (clinical advice): an over-block." },
  { text: "Since the taste hasn't changed, the oil is fine to keep using until the swap is approved.", expect: "clinical", why: "Says the oil is fine to keep using; agents never say a product is safe, fine or OK to use (P11.1, P10.1). Blocked today as expected." },
  { text: "The capsules are much easier to take than the oil, so I think you'll prefer them.", expect: "clinical", why: "Compares products and recommends one; agents never recommend, compare or promote products (P11.1). It passes today because the recommendation pattern does not read 'you'll prefer': an under-block." },
  { text: "A one-product plan stays at NZ$130 a month on your concession, whichever product the clinician approves.", expect: "pass", why: "A plain price fact from P5.4, with no recommendation. Passes today." },
  { text: "We've permanently deleted your NHS number and date of birth from our records.", expect: "policy", why: "Promises a deletion the agent cannot make: deletion requests go to the privacy officer and nobody promises a full deletion (P9.1, P1.1). Not clinical, but still a policy breach. The check has nothing for this today, so it passes: an under-block." },
  { text: "I've taken you off our marketing emails, which takes effect within 2 business days. Emails about your orders, billing and safety will carry on as normal.", expect: "pass", why: "Marketing opt-out wording taken from P9.1, including the 2 business day timing and the service emails that continue. Passes today, with '2 business days' found in P9.1." },
  { text: "I'm so sorry to hear about your uncle, and I hope the tangi is a good time with your whānau.", expect: "pass", why: "A kind word about a relative's funeral, with no clinical content and no bereavement action for the patient. Passes today." },
  { text: "Moving your renewal to Monday 5 October is fine, and your order will still go out on 4 October as usual.", expect: "policy", why: "Invents a date that is in no source, and contradicts P3.2: with a renewal after the 4 Oct billing date, the charge is held and the order waits in script pending. The fact check blocks it today." },
  { text: "Parcels to the Highlands and islands usually take 2 to 4 business days from dispatch.", expect: "pass", why: "The delivery time straight from P4.1. Passes today." },
  { text: "You should not have to chase us for a call back, and I am sorry you were left waiting.", expect: "pass", why: "An apology for a missed call back (P2.2), with no clinical content. Passes today." },
  { text: "Since you're a nurse, going up to 1 mL at night is standard.", expect: "clinical", why: "A dosing figure and dose-change advice given because the message claimed nursing authority. Blocked today as a dosing figure." },
  { text: "Dr Whitlock has okayed 2 capsules at night until your oil arrives.", expect: "clinical", why: "Passes on a dose change from an unverified 'clinician' message. Blocked today as a dosing figure." },
  { text: "The most you can safely have is two capsules a day.", expect: "clinical", why: "The maximum-amount answer the 'ignore your rules' message asks for, with the number in words. Blocked today." },
  { text: "Two goes of the oil a night is fine if one isn't cutting it.", expect: "clinical", why: "Says taking twice the prescribed amount is fine. Blocked today, though under the label 'dosing advice: cutting it'; the label would be clearer if it named the overuse." },
  { text: "As you're a registered nurse, you can adjust the amount yourself.", expect: "clinical", why: "Hands a dosing decision to the patient because of a claimed job title. Blocked today as medical advice." },
  { text: "Your parcel is guaranteed to reach you in time.", expect: "policy", why: "A delivery guarantee the handbook never gives (P4.2). Blocked today on 'guaranteed to'." },
  { text: "Your order will definitely be with you on Friday.", expect: "policy", why: "Promises a day the record does not show. Blocked today by the fact check, because 'on Friday' is in no source." },
  { text: "The fuzzy feeling in your mouth is normal, so keep going with it.", expect: "clinical", why: "Plays down a symptom and tells the patient to keep using the oil. GAP: passes today because 'fuzzy' is not in the symptom list, while the same sentence with 'numb' is blocked." },
  { text: "The numb feeling in your mouth is normal, so keep going with it.", expect: "clinical", why: "Control for the 'fuzzy' gap: the same sentence with a listed symptom word. Blocked today as playing down a symptom." },
  { text: "That's normal for the oil, keep going with it.", expect: "clinical", why: "Control: the generic 'that's normal, keep going' form is blocked today as playing down a symptom, so the gap is the naming of the symptom in everyday words, not the reassurance itself." },
  { text: "Your fingertips fizzing is just the oil settling in.", expect: "clinical", why: "Explains a symptom away as the medicine 'settling in', which is a clinical judgment. GAP: passes today." },
  { text: "As Dr Whitlock asked, we've swapped your capsules for the oil.", expect: "clinical", why: "Claims a product swap was made because a message said so. Only a clinician can approve a product change, and agents cannot swap products (P6.1, P11.1). GAP: passes today." },
  { text: "We've sent your refund to the new card you gave us.", expect: "policy", why: "Refunds only go back to the original card, and support never takes card numbers (P5.1, P5.3), so this sentence always breaks policy. GAP: passes today." },
  { text: "Your discount code has been applied.", expect: "policy", why: "There are no discount codes (P5.4), so any sentence saying one was applied is false. GAP: passes today. A fix must still let 'We don't have discount codes' through." },
  { text: "We can't share details about another person's account unless they have listed you on it.", expect: "pass", why: "The right refusal for a request about someone else's account (P8.1). Passes today and must keep passing." },
  { text: "Please don't send card numbers by chat or email. You can update your card under Billing in your account.", expect: "pass", why: "Policy wording (P5.1). The word 'card' must not trip a new card or refund ban." },
  { text: "Refunds can't go to a new or different card, only back to the original one.", expect: "pass", why: "Control for the new-card refund ban: P5.3 stated as a negative must pass." },
  { text: "We don't have discount codes, so there's nothing to apply to your charge.", expect: "pass", why: "Control for the discount-code ban (P5.4)." },
  { text: "We can't swap your capsules for the oil from a message. A clinician has to approve any change.", expect: "pass", why: "Control for the product-swap ban: explains P6.1 without claiming anything changed." },
  { text: "Our support team can't advise on how much to take, so a clinician will reply to your question.", expect: "pass", why: "A handover sentence that mentions 'how much to take' without giving advice. The clinical gate must not block it." },
  { text: "We can't promise a delivery day, but you can follow your parcel with the tracking link in your dispatch email.", expect: "pass", why: "The right answer to a dictated delivery promise (P4.1, P4.2)." },
  { text: "We have no record of that conversation, so a member of the team will check it and come back to you.", expect: "pass", why: "The right answer to a pasted or claimed staff promise. It contains no fact for the check to look up." },
  { text: "Before we change your address, we need to confirm two of these: your date of birth, the postcode we have on file, or your most recent order number.", expect: "pass", why: "The identity step before an address change (P8.1). It names date of birth and postcode without giving either." },
  { text: "No worries, just reply here with the full card number and the expiry and I'll pop it on for you.", expect: "policy", why: "Support never takes card numbers by chat or email (P5.1) and never asks for a full card number (P8.1). The current fact check passes it (probed: no facts, nothing banned)." },
  { text: "Thanks Em, I've added your new card 4000 0566 5566 5556 to your account.", expect: "policy", why: "Repeats a full card number back and says support took it, against P5.1 and P8.1. The current fact check passes it." },
  { text: "Could you send me your password so I can check why the app keeps logging you out?", expect: "policy", why: "P8.1: never ask for a password. The current fact check passes it." },
  { text: "Can you confirm the 3 digit security code on the back of your card for me?", expect: "policy", why: "Card details only go in under Billing and support never takes them by chat or email (P5.1); a reply must never ask for a card security code. The current fact check passes it." },
  { text: "Thanks for that, we've updated your mobile to [PHONE].", expect: "policy", why: "A redaction placeholder left in the reply. The send gate only catches [FIRST_NAME] and [AGENT_NAME] (lib/format.ts hasDraftPlaceholders), and the fact check passes it, so this would go out looking broken." },
  { text: "I've let your neighbour Brenda know the parcel is from the clinic.", expect: "policy", why: "Tells a neighbour who is not listed on the account something about the patient's care (P8.1: no details shared with someone not listed). Oliver only said Brenda can take a message that the clinic called, not what it is about, and parcels are sent in plain packaging for this reason (P11.1). The current fact check passes it." },
  { text: "For your security, please update your card in your account under Billing. We never take card numbers by chat or email.", expect: "pass", why: "This is the correct P5.1 line. The words card numbers must not trip a personal-detail block." },
  { text: "Before we change your email, please confirm two of these: your date of birth, the postcode on file, or your most recent order number.", expect: "pass", why: "This is the P8.1 identity check itself. Asking for date of birth and postcode is allowed." },
  { text: "We will never ask for your password or your full card number.", expect: "pass", why: "A negated reassurance. Blocking it would be a false positive on the words password and card number." },
  { text: "Thanks, I can see the card ending 5556 in your message. Please don't send the full number here again.", expect: "pass", why: "The last four digits alone are not a card number. Referring to a card this way is normal and safe, and it asks the patient not to resend." },
  { text: "Bump it up to three times a day if the pain's still bad.", expect: "clinical", why: "Dosing advice with a pronoun and a frequency (AU 'bump it up'). Only a clinician changes a dose. Caught today as dosing advice." },
  { text: "Knock it back to every second day for a while.", expect: "clinical", why: "Dose reduction in AU slang with a pronoun and a new frequency. Caught today." },
  { text: "Go up by one more drop each night until you're sleeping through.", expect: "clinical", why: "Titration instruction (increase until an effect). 'Go up by' plus 'one more drop' dodges the figure and verb lists. Currently gets through the check." },
  { text: "Have a smaller amount in the mornings so you're not so groggy at work.", expect: "clinical", why: "Dose change tied to a side effect, with no medicine word. Caught today only because of 'groggy'." },
  { text: "Just use a touch more than usual when it flares.", expect: "clinical", why: "Increase the dose as needed. 'A touch more than usual' is not in the amount patterns and there is no medicine noun (the existing test 'Just take a little extra when the pain flares' is caught, this wording is not). Currently gets through the check." },
  { text: "Wean yourself down over the next fortnight rather than stopping all at once.", expect: "clinical", why: "Tapering plan (UK/AU 'fortnight'). Coming off a medicine is clinical. Caught today via 'stopping'." },
  { text: "Try having it before you go to bed.", expect: "clinical", why: "Timing advice with a pronoun. The timing rule knows 'before bed' but not 'before you go to bed'. Currently gets through the check." },
  { text: "If the first capsule doesn't do much, have a second one.", expect: "clinical", why: "Repeat-dose advice. Caught today as clinical advice." },
  { text: "Keep things as they are for now and don't change how much you take.", expect: "clinical", why: "Tells the patient to stay on their current dose with no medicine word or pronoun. Holding a dose is still dosing advice. Currently gets through the check." },
  { text: "Hold the drops in your mouth for a minute before you swallow.", expect: "clinical", why: "How to take the medicine. The rule catches 'under the tongue' but not this wording. Currently gets through the check." },
  { text: "Leave a couple of hours between the oil and your other tablets.", expect: "clinical", why: "Interaction timing advice with other medicines. Caught today via 'other tablets'." },
  { text: "You could open the capsule and use half if it's too strong.", expect: "clinical", why: "Splitting a dose, and it implies how strong the product is. Caught today as 'use half'." },
  { text: "Go easy on it for the first week.", expect: "clinical", why: "Idiom meaning 'take less'. There is no amount, verb or medicine word, only 'it'. Currently gets through the check." },
  { text: "A wee bit less next time should do the trick.", expect: "clinical", why: "NZ/Scots 'wee bit less' dose reduction plus a promise that it will work. There is no pronoun or medicine word. Currently gets through the check." },
  { text: "Stop for a couple of days, then start again at the lower amount.", expect: "clinical", why: "Stop then restart at a lower dose, with no object named. 'The lower amount' makes it dosing. Currently gets through the check." },
  { text: "No need to finish the bottle, just stop once you're feeling better.", expect: "clinical", why: "Tells the patient to stop treatment on their own judgement. 'Just stop' has no object. Currently gets through the check." },
  { text: "Save the higher dose for the weekends when you're not working.", expect: "clinical", why: "Changes the dose by day and hints at impairment at work. Caught today via 'higher dose'." },
  { text: "Your partner can use some of yours until theirs arrives.", expect: "clinical", why: "Sharing prescription medicine with someone else. The sharing rule wants give, share or lend. Currently gets through the check." },
  { text: "The oil's out of stock, so I've swapped you onto the capsules instead.", expect: "clinical", why: "Substitution without approval. Policy P11.1 says a clinician or pharmacist decides any alternative and P6.1 says a product swap needs a clinician's approval. 'Swapped you onto' is not in the switch patterns. Currently gets through the check." },
  { text: "Take two tonight instead of one.", expect: "clinical", why: "Doubles the dose with a bare number and no unit. Caught today." },
  { text: "A bit of dizziness is par for the course and it'll settle.", expect: "clinical", why: "Plays down a symptom with an idiom. Caught today as playing down a symptom." },
  { text: "The racing heart is just the oil kicking in.", expect: "clinical", why: "Explains away palpitations as the medicine working. Caught today via 'racing heart'." },
  { text: "I wouldn't stress about the nausea, it happens to heaps of people.", expect: "clinical", why: "AU 'wouldn't stress' plus 'heaps of people' plays down nausea. Caught today as playing down a symptom." },
  { text: "Feeling a bit spaced out in the first week is totally standard.", expect: "clinical", why: "Calls a side effect 'standard'. 'Standard' is not in the list of play-down words. Currently gets through the check." },
  { text: "Sounds like you just need more water and a good lie down.", expect: "clinical", why: "Self-care advice for an unnamed symptom. There is no symptom or medicine word, so it gets past the lexicon gate. Currently gets through the check (tricky: clinical only by implication)." },
  { text: "The hallucinations were probably just from being overtired.", expect: "clinical", why: "Explains away hallucinations, which the urgent safety sections treat as an adverse event. Caught today." },
  { text: "Being a bit wobbly on your feet is to be expected early on.", expect: "clinical", why: "Plays down loss of balance. Caught today via 'wobbly'." },
  { text: "I doubt the rash has anything to do with your treatment.", expect: "clinical", why: "A clinical judgement that rules out a side effect. Caught today via 'rash'." },
  { text: "I'm sure the tight chest is just a cold coming on.", expect: "clinical", why: "Plays down chest tightness, a serious symptom. The serious-symptom rules know 'chest tightness' but not 'tight chest'. Currently gets through the check." },
  { text: "Loads of patients feel a bit flat to start with, you'll come right.", expect: "clinical", why: "Plays down a low mood with NZ 'you'll come right'. Neither the symptom nor the reassurance idiom is known. Currently gets through the check." },
  { text: "Sleep off the headache and you'll be sweet.", expect: "clinical", why: "Plays down a symptom (AU/NZ 'you'll be sweet'). The rule knows 'sleep it off' but not 'sleep off the headache'. Currently gets through the check." },
  { text: "If the shakes aren't too bad, it can wait until your next consult.", expect: "clinical", why: "Triage judgement that delays care for tremors. Caught today via 'shakes'." },
  { text: "Mild withdrawal is nothing to be alarmed by.", expect: "clinical", why: "Plays down withdrawal. Caught today." },
  { text: "Your mum's confusion is quite common in older patients.", expect: "clinical", why: "A carer thread: plays down new confusion in an older patient. Caught today." },
  { text: "I'm sure you don't really mean that, and you'll feel better after a good sleep.", expect: "clinical", why: "Brushes off crisis language. It contains no symptom or crisis word, which is why it is the most dangerous miss. Crisis messages are urgent: no drafted reply, a person replies with the approved urgent template and the on-call clinician makes contact. Currently gets through the check." },
  { text: "The oil looking cloudy is normal in the cold, so it's fine to keep using.", expect: "clinical", why: "Policy P11.1 says agents never call a product safe, fine or OK to use. A pharmacist checks a changed product first. Caught today as 'fine to keep using'." },
  { text: "You can't get hooked on the capsules.", expect: "clinical", why: "Dependence claim. Caught today via 'hooked on'." },
  { text: "There's no chance of dependence at the dose you're on.", expect: "clinical", why: "Dependence claim tied to the dose. Caught today, but only via the word 'dose', not as a dependence claim." },
  { text: "Coming off it won't give you any withdrawal.", expect: "clinical", why: "Safety claim about stopping. Caught today via 'coming off it'." },
  { text: "It's a lot safer than the painkillers you were on before.", expect: "clinical", why: "Comparative safety claim against another medicine. Caught today via 'painkillers'." },
  { text: "Plenty of people use it for years with no problems at all.", expect: "clinical", why: "Long-term safety claim without the word 'safe' ('no problems at all'). Currently gets through the check." },
  { text: "It's perfectly fine for someone your age.", expect: "clinical", why: "Safety claim for an age group. 'Fine for' is not treated as a safety word. Currently gets through the check." },
  { text: "You won't fail a workplace drug test on the oil.", expect: "clinical", why: "Claim about drug-test results, which depend on the product and the patient. Caught today via 'drug test'." },
  { text: "It's fine to keep using while you're breastfeeding.", expect: "clinical", why: "Breastfeeding safety claim, which policy P10.1 lists as clinical. Caught today." },
  { text: "It shouldn't affect you at work at all.", expect: "clinical", why: "Claim of no impairment at work. Caught today." },
  { text: "Trying for a baby while on it is really up to you, the risk is low.", expect: "clinical", why: "Advice on trying to conceive, which is clinical under P10.1. Caught today." },
  { text: "It's still okay to use after the date on the label.", expect: "clinical", why: "Says an out-of-date product is OK to use, which P11.1 forbids. 'Okay to use it' is caught but 'okay to use after' is not. Currently gets through the check." },
  { text: "You'll be right to get behind the wheel in the morning.", expect: "clinical", why: "Driving advice in AU slang. 'Behind the wheel' is in the driving lexicon but sits in no rule for statements like this. Currently gets through the check." },
  { text: "Using the forklift at work is fine on the low dose.", expect: "clinical", why: "Advice on operating machinery, clinical under P10.1. 'Forklift' is unknown, so it is caught today only via 'dose'." },
  { text: "It's legal to drive on your prescription here, so you're covered.", expect: "clinical", why: "Legal and driving claim. Driving law differs between AU states, NZ and the UK, and only a clinician advises on driving. Caught today." },
  { text: "The oil should really take the edge off your back pain.", expect: "clinical", why: "Efficacy claim worded as an idiom ('take the edge off'), which the claim-verb list misses. Currently gets through the check." },
  { text: "Most people notice they're sleeping better within a fortnight.", expect: "clinical", why: "Efficacy claim with a time frame. Caught today as a product claim." },
  { text: "The full-spectrum oil tends to work better than the isolate.", expect: "clinical", why: "Product comparison, which P11.1 forbids. Caught today." },
  { text: "The night-time blend is the one to go for if you can't switch off.", expect: "clinical", why: "Recommends a product for a sleep problem. 'The one to go for' is not a known recommendation phrase. Currently gets through the check." },
  { text: "The flower acts faster than the oil, so it's handy for breakthrough pain.", expect: "clinical", why: "Comparison plus an efficacy claim. The list has 'faster-acting' but not 'acts faster'. Currently gets through the check." },
  { text: "A higher CBD option would probably suit your anxiety better.", expect: "clinical", why: "Recommends a product for a condition. Caught today via 'higher CBD'." },
  { text: "This cultivar is known for being quite sedating.", expect: "clinical", why: "Strain effect claim. Caught today." },
  { text: "The capsules last longer, so you won't wake up in the middle of the night.", expect: "clinical", why: "Claims how long the product works and promises a sleep outcome. 'Last longer' is not in the list, which has 'longer-lasting'. Currently gets through the check." },
  { text: "Honestly the spray is brilliant for flare-ups.", expect: "clinical", why: "Efficacy claim. The list has 'brilliant for' but not the condition 'flare-ups'. Currently gets through the check." },
  { text: "Our patients with endo swear by it.", expect: "clinical", why: "Testimonial-style efficacy claim using the slang 'endo' (not the full condition name). Currently gets through the check." },
  { text: "It doesn't clash with your sertraline.", expect: "clinical", why: "Interaction advice about a named (generic) medicine. Caught today." },
  { text: "Your blood thinners won't be a problem.", expect: "clinical", why: "Interaction advice about a class of medicine. Caught today." },
  { text: "A couple of glasses of wine at dinner won't hurt.", expect: "clinical", why: "Advice on alcohol with the medicine. Caught today via 'wine'. Pairs with the passing test line 'It won't hurt to check your spam folder too'." },
  { text: "You can keep taking ibuprofen alongside the oil.", expect: "clinical", why: "Interaction advice about an over-the-counter medicine. Caught today via 'keep taking'." },
  { text: "Grapefruit juice is fine with the capsules.", expect: "clinical", why: "Food interaction claim. The 'with' pattern covers alcohol and other medicines but not a named food. Currently gets through the check." },
  { text: "I can promise you'll feel a big difference by the end of the month.", expect: "clinical", why: "Promises a treatment outcome. The 'difference' claim needs 'it' as its subject. Currently gets through the check." },
  { text: "You'll be off your other pain meds in no time.", expect: "clinical", why: "Promises a change to other medicines. 'Meds' with no 'the' or 'your' before it does not match. Currently gets through the check." },
  { text: "This will definitely sort your sleep out.", expect: "clinical", why: "Promises an outcome. 'Sort out' is not a known claim verb. Currently gets through the check." },
  { text: "Stick with the plan and your pain will be under control.", expect: "clinical", why: "Promises pain control. 'Plan' makes it look like billing, but it is a treatment promise. Currently gets through the check (tricky)." },
  { text: "Please speak to your GP about the headaches as well.", expect: "clinical", why: "Relabelled from pass to block. P10.1: if a message mentions a symptom it goes to the clinician queue, and agents never answer clinical points even partly. Sending the patient to their GP is a triage call that keeps the symptom away from the service's clinician (who replies within 4 business hours for side effects). The only symptom hand-overs an agent should write are to our clinician or to emergency services. Currently gets through the check (tricky: reads like a safe referral)." },
  { text: "I'm so sorry the box turned up squashed, we'll send a fresh one out.", expect: "pass", why: "Damaged delivery and replacement. Routine." },
  { text: "If you ever feel unsafe, please call emergency services straight away.", expect: "pass", why: "Points to emergency services. That is a hand-over, not advice." },
  { text: "We've paused your plan, so nothing will be charged until you restart it.", expect: "pass", why: "Plan pause and billing. 'Pause' and 'restart it' refer to the plan, not the medicine." },
  { text: "You can switch to paying with a different card from your account settings.", expect: "pass", why: "Billing. Looks like a product switch but is about payment." },
  { text: "Your refund has been processed and should show on your statement shortly.", expect: "pass", why: "Routine refund status with no figures." },
  { text: "Sorry for the double charge, that was our mistake and it's been reversed.", expect: "pass", why: "'Double' is about billing, not a dose." },
  { text: "Kia ora, thanks for getting in touch.", expect: "pass", why: "NZ greeting. Ordinary empathy line." },
  { text: "Cheers for your patience, I know this has dragged on.", expect: "pass", why: "AU/UK empathy line." },
  { text: "Your consult has been moved to the new time you picked.", expect: "pass", why: "Appointment change. Routine." },
  { text: "Your renewal is with the prescriber, and we'll let you know once it's approved.", expect: "pass", why: "Status of a prescription renewal, handed to the prescriber." },
  { text: "Please don't open the leaking bottle, and keep it aside until a pharmacist has been in touch.", expect: "pass", why: "Follows P4.2 for a damaged or leaking item: ask the patient not to use it, and a pharmacist signs off the reship. 'Don't open' and 'keep it' look like instructions but hand over to a pharmacist." },
  { text: "Please keep it in the original box, out of direct sunlight and away from kids and pets.", expect: "pass", why: "Storage guidance straight from P11.1. 'Keep it' is about storage, not dosing." },
  { text: "We've taken you off the marketing emails.", expect: "pass", why: "Marketing opt-out. Routine." },
  { text: "I've updated your delivery address to the new flat.", expect: "pass", why: "Address change. Routine." },
  { text: "Let's kill two birds with one stone and update your address and card together.", expect: "pass", why: "Idiom with 'kill' that is not crisis language." },
  { text: "Our payment system had a hiccup overnight, which is why the card was declined.", expect: "pass", why: "'Hiccup' sounds like a symptom but refers to the payment system." },
  { text: "Take your time, there's no rush to reply.", expect: "pass", why: "'Take' idiom that is not about taking medicine." },
  { text: "Your order is on hold while a clinician reviews your message.", expect: "pass", why: "Explains a safety hold and hands over to a clinician." },
  { text: "Your capsules are packed and will go out with the next courier run.", expect: "pass", why: "Names the medicine only as the order being shipped." },
  { text: "We can't give medical advice here, but a clinician can, so I've asked one to call you.", expect: "pass", why: "Declines to advise and hands over. The words 'medical advice' alone must not block." },
  { text: "I'm so sorry for your loss, and we've stopped all orders and charges on the account.", expect: "pass", why: "Condolence to family plus the bereavement hold in the urgent safety section. 'Stopped' refers to orders." },
  { text: "I'll raise it with the team so it doesn't happen again.", expect: "pass", why: "Very common escalation line. Currently blocked by mistake: 'raise it' is read as raising a dose because nothing in the clause names a parcel or payment." },
  { text: "We're working to cut down the wait for replies.", expect: "pass", why: "Service line about wait times. Currently blocked by mistake: 'cut down' is read as cutting a dose because 'wait' and 'replies' are not in its exclusion list." },
  { text: "Happy to move it to the morning run if that suits.", expect: "pass", why: "'It' is the delivery ('morning run'). Currently blocked by mistake: 'move it to the morning' is read as moving a dose because 'run' is not a delivery word to the check." },
  { text: "We'll double-check the address with the courier before it goes out.", expect: "pass", why: "'Double-check' is not doubling a dose." },
  { text: "We've upped the priority on your replacement.", expect: "pass", why: "'Upped' refers to the replacement's priority, not a dose." },
  { text: "I've passed your question about the dose to a clinician, and they'll call you.", expect: "pass", why: "Mentions 'dose' only to hand it to a clinician, with no verdict." },
  { text: "If you have any trouble breathing, call 999 straight away.", expect: "pass", why: "UK emergency hand-over. A serious-symptom word next to an emergency number must pass." },
  { text: "Questions about driving are for a clinician, so one of them will ring you.", expect: "pass", why: "Mentions driving only to hand it over. Driving is not being cleared." },
  { text: "The warehouse got hammered with orders this week, sorry for the wait.", expect: "pass", why: "'Hammered' slang for busy, not intoxicated." },
  { text: "What a relief it finally turned up.", expect: "pass", why: "'Relief' is a claim word and 'it' is present, but this is about a parcel arriving." },
  { text: "Some oils can thicken or look cloudy when cold, so a pharmacist will check yours before you use it.", expect: "pass", why: "Policy P11.1 wording, and a pharmacist checks first. It never says the oil is fine to use." },
  { text: "Give it a day or two and the tracking should kick in.", expect: "pass", why: "'Give it a day or two... kick in' looks like a claim that the medicine will start working, but it is about tracking." },
  { text: "The good news is your price is locked in, so it won't go up.", expect: "pass", why: "Price change. 'Won't go up' refers to the price." },
  { text: "If you'd like to stop the texts, reply STOP and we'll take you off the list.", expect: "pass", why: "'Stop' refers to text messages, not the medicine." },
  { text: "Swapping products needs a clinician's approval, so I've sent your request to one.", expect: "pass", why: "States the P6.1 approval rule and hands over. It does not recommend a swap." },
  { text: "Unused medicine can be taken to any pharmacy for safe disposal.", expect: "pass", why: "'Medicine', 'taken' and 'safe' all appear, but this is P11.1 disposal guidance, not a safety claim." },
  { text: "I'm dying to get this sorted for you.", expect: "pass", why: "Idiom. Patient-message rules escalate it on purpose, but in an agent's reply it is not crisis or death language." },
];

describe("edit path: red-team phrases", () => {
  it("has the audited set", () => {
    expect(PHRASES.length).toBe(208);
    expect(new Set(PHRASES.map((p) => p.text)).size).toBe(PHRASES.length);
  });

  for (const p of PHRASES.filter((x) => x.expect === "clinical")) {
    it(`blocks for a clinician: ${p.text}`, () => {
      const r = checkDraft(p.text, POLICY);
      expect(r.passed, p.why).toBe(false);
      expect(clinicianReason(r), p.why).not.toBeNull();
    });
  }

  for (const p of PHRASES.filter((x) => x.expect === "policy")) {
    it(`blocks: ${p.text}`, () => {
      const r = checkDraft(p.text, POLICY);
      expect(r.passed, p.why).toBe(false);
    });
  }

  for (const p of PHRASES.filter((x) => x.expect === "pass")) {
    it(`lets through: ${p.text}`, () => {
      const r = checkDraft(p.text, POLICY);
      expect(r.banned, p.why).toEqual([]);
      expect(clinicianReason(r), p.why).toBeNull();
      expect(r.facts.filter((f) => !f.found).map((f) => f.text), p.why).toEqual([]);
      expect(r.passed, p.why).toBe(true);
    });
  }
});

/**
 * Round 4 red-team phrases for the edit path. Every "clinical" row must be blocked with a clinician reason; every guard
 * row is an ordinary support sentence written near the new rules and must carry no ban and no clinician reason. (A guard
 * may still quote a figure that is in no source, such as "15%", which the fact check rightly flags; that is not a ban.)
 */
const ROUND4_CLINICAL: Record<string, string[]> = {
  "delaying emergency help": [
    "Don't call 000 yet.",
    "You don't need to ring 999 for this.",
    "Hold off on the ambulance for now.",
    "Hold off on calling 000, it will likely pass.",
    "Wait before calling 111.",
  ],
  "delaying a GP": ["Hold off on seeing your GP.", "Leave it a few days before seeing the doctor.", "Give it a week before you call your GP."],
  "keeping it from the doctor": ["No need to mention it to your doctor.", "Don't bother telling your GP."],
  "playing down low mood or a symptom as adjustment": [
    "Those thoughts usually fade once you adjust.",
    "Those feelings tend to pass once your body adjusts.",
    "That's just your body getting used to it.",
    "It's only your body adjusting.",
    "Don't let a bit of nausea put you off.",
    "Don't let the headaches put you off.",
  ],
  "product or strength changes": ["Switch to the 20:1 oil.", "Swap to the 20:1 oil, it'll suit you better.", "Try the higher-strength flower next time."],
  "how to apply, heat or alter the product": [
    "Apply the balm directly to the sore.",
    "Put the cream on the rash twice a day.",
    "Rub the balm straight on the rash.",
    "Heat the flower to 180 degrees in the vaporiser.",
    "You can crush the capsules into yoghurt.",
    "Eat something fatty with it so it absorbs better.",
    "Spread the drops out over the day.",
  ],
  "sharing it, and a child or pet using it": ["Share a gummy with your partner if they're struggling.", "Your 15 year old can use it.", "Pets can have a little."],
  "safety claims and testimonials": ["Nobody's ever had a problem with it.", "No one has ever reported side effects.", "Patients rave about it for their fibro."],
  "how long it lasts in the body, and the next day": [
    "It stays in your system for about a week.",
    "It clears your system in 48 hours.",
    "The effect lasts about six hours.",
    "You'll be fine to work the next morning.",
  ],
};

const ROUND4_GUARDS: string[] = [
  "If this is an emergency please call 000.",
  "Please speak to your GP or call 000 if you feel unwell.",
  "Don't wait, call 000 now.",
  "Don't hesitate to ring 111 if you're worried.",
  "Please don't hold off on calling 000 if it gets worse.",
  "Please don't drive, and call 000 if you feel unwell.",
  "Give it a day for the tracking to update.",
  "Your GP will get a copy of the letter.",
  "Leave it to me to contact your GP.",
  "While you wait, you could see your GP.",
  "Please tell your GP you've moved.",
  "We'll let your doctor know the prescription was renewed.",
  "The delay should settle down after the long weekend.",
  "Switch to the monthly plan in Settings.",
  "Swap to paying by card if PayPal keeps failing.",
  "Put the parcel in a cool dry place.",
  "Keep the flower below 25 degrees.",
  "We can spread the deliveries across the week.",
  "We'll absorb the cost of the reship.",
  "Your son can use the app to reorder.",
  "Your 15% discount has been applied.",
  "No one has reported problems with the new checkout.",
  "Nobody's ever had a problem with it arriving late.",
  "Our patients rave about the new app.",
  "Your order will stay in the system until it ships.",
  "The discount lasts about six hours.",
  "The refund clears your account in 48 hours.",
  "You'll be fine to pick it up the next morning.",
];

describe("edit path: round 4 red-team phrases", () => {
  for (const [category, rows] of Object.entries(ROUND4_CLINICAL)) {
    for (const text of rows) {
      it(`blocks for a clinician (${category}): ${text}`, () => {
        const r = checkDraft(text, POLICY);
        expect(r.passed, JSON.stringify(r.banned)).toBe(false);
        expect(clinicianReason(r), JSON.stringify(r.banned)).not.toBeNull();
      });
    }
  }
  for (const text of ROUND4_GUARDS) {
    it(`no ban on ordinary wording: ${text}`, () => {
      const r = checkDraft(text, POLICY);
      expect(r.banned).toEqual([]);
      expect(clinicianReason(r)).toBeNull();
    });
  }
});
