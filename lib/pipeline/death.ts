/**
 * Whose death is it? One source of truth for every screen and every patient-level lock.
 *
 * The safety rules stop on every mention of a death, on purpose: a missed patient death is the failure that matters.
 * But a message can report a death AND show that the writer is the living patient, still using their own treatment
 * ("My brother died three weeks ago ... I've been taking more of my oil than I'm meant to", MSG-0172). Then the
 * patient's own care leads:
 *   - the rules add a hit with ruleId LIVING_PATIENT_RULE_ID (category adverse_event), so the message is urgent with its
 *     orders on hold and is labelled an adverse event on the desk, the rail, the trail and the clinician screen;
 *   - no patient-level bereavement alert is raised, so the patient's other replies are held "clinician first" rather
 *     than withdrawn as if the patient had died.
 * The same holds, with bereavement still the label, when a relative's death is named and the message is signed with the
 * patient's own first name ("My dad passed away last month ... Mele Taufa", MSG-0120): the rules add a hit with ruleId
 * RELATIVE_DEATH_RULE_ID (category bereavement) when the pipeline knows the patient's name.
 * When both could apply, the relative reading wins unless the writer also reports overusing their own treatment: a
 * relative's funeral with only "my capsules are meant to arrive" (MSG-0923) is grief, not a serious reaction.
 * Any sign that the writer is acting for someone else ("I'm writing for my father", "using his account", "the capsules
 * she left") cancels both readings.
 * A death mention with no such signal ("My husband passed away") stays a possible patient death: the safe side.
 *
 * Tiny and dependency free (types only), so the desk and clinician screens can import it without the pipeline.
 * Every patient and message is fictional demo material.
 */
import type { Route, RuleHit, SafetyCategory } from "@/lib/types";

/** The rule id of the hit the rules add when a message mentions a death but the writer is the living patient. */
export const LIVING_PATIENT_RULE_ID = "adverse.living_patient";

/**
 * The rule id of the hit the rules add when a message names the death of someone close to the patient and is signed
 * with the patient's own first name (MSG-0120: "My dad passed away last month ... Mele Taufa"). Category bereavement:
 * the death still stops the message, but it is not the patient's, so no reply to the patient is withdrawn.
 */
export const RELATIVE_DEATH_RULE_ID = "bereavement.relative_of_patient";

/** The rule ids that read the writer as the living patient. */
const LIVING_IDS: ReadonlySet<string> = new Set([LIVING_PATIENT_RULE_ID, RELATIVE_DEATH_RULE_ID]);

const RELATIVE =
  "mum|mom|mother|dad|father|brother|sister|husband|wife|partner|son|daughter|nan|nana|nanna|gran|grandma|grandmother|" +
  "grandad|granddad|grandpa|grandfather|uncle|aunt|aunty|auntie|cousin|nephew|niece|friend|best friend|mate|flatmate|" +
  "colleague|stepdad|stepmum|stepfather|stepmother|fiance|fiancee|father-in-law|mother-in-law";
/** A funeral, in English or te reo Maori: "my uncle Hēmi's tangi", "a tangi for my uncle", "Dad's funeral". */
const FUNERAL = "funeral|tangi|tangihanga|memorial|memorial service|wake|cremation|burial";
const RELATIVE_DEATH = new RegExp(
  String.raw`\bmy (?:late |dear )?(?:${RELATIVE})\b([^.!?\n]{0,40}?)\b(?:died|passed away|passed on|passed|was killed|lost (?:his|her|their) (?:life|battle|fight))\b|\blost my (?:${RELATIVE})\b` +
    // Someone else's funeral, named as the writer's relative (MSG-0923, MSG-0945): the writer is alive and it is not
    // their death, so the same signed-by-the-patient test applies as for "my dad passed away".
    String.raw`|\bmy (?:late |dear )?(?:${RELATIVE})(?: [^\s'’.,!?]+)?['’]s (?:${FUNERAL})\b|\b(?:${FUNERAL}) (?:for|of) my (?:late |dear )?(?:${RELATIVE})\b`,
  "i",
);

/**
 * Words that show the writer is acting for someone else, usually the person who died: "I'm writing for my father",
 * "on behalf of my wife", "using his account", "the capsules she left", "his things", "I'm her son". Any of them means
 * the account holder may be the one who died, so the message stays a possible patient death (the safe side), whatever
 * else it says about "my oil" or a sign-off.
 */
const WRITING_FOR_SOMEONE = new RegExp(
  [
    String.raw`\b(?:writing|write|emailing|messaging|contacting you|reaching out|getting in touch|asking) (?:for|on behalf of) (?:my|him|her|them)\b`,
    String.raw`\bon (?:his|her|their) behalf\b|\bon behalf of\b|\bnext of kin\b|\bexecutor\b|\bprobate\b|\b(?:his|her|their) estate\b`,
    String.raw`\b(?:using|use|used|on|from|through|via|into|in|access to|accessing|logged into|log into|close|closing|cancel|cancelling|canceling) (?:his|her|their) (?:account|e-?mail|login|log-?in|phone|profile|details|subscription|plan|orders?)\b`,
    String.raw`\bi(?:['’]m| am) (?:his|her|their) (?:${RELATIVE}|carer|caregiver)\b`,
    String.raw`\b(?:the|those|these|some|any)? ?(?:oils?|capsules?|caps|sprays?|drops|gummies|meds|medication|medicine|tablets?|pills?|bottles?)\b (?:that |which )?(?:he|she|they) (?:left|had left|had|was (?:prescribed|using|taking|on)|were (?:prescribed|using|taking|on)|used)\b`,
    String.raw`\b(?:his|her|their) (?:things|belongings|affairs|stuff)\b`,
    String.raw`\b(?:for|to) (?:him|her|them) (?:any ?more|now|from now on)\b|\b(?:cancel|stop|pause|close)\b[^.!?\n]{0,40}\bfor (?:him|her|them)\b`,
  ].join("|"),
  "i",
);

/** True when the message shows the writer is acting for someone else (see WRITING_FOR_SOMEONE). */
export function writesForSomeoneElse(text: string): boolean {
  return WRITING_FOR_SOMEONE.test(text);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The words that read as the patient writing about someone close to them ("My dad passed away"), or null. All must
 * hold: the death is a relative's and does not name the patient, the message is signed with the patient's first name,
 * and nothing shows the writer acting for someone else. A family member reporting the patient's death names the patient
 * and signs with their own name, so it never matches. One source of truth for the rules (the RELATIVE_DEATH_RULE_ID
 * hit, which decides whether the patient's other replies are withdrawn) and the clinician screen's wording.
 */
export function relativeDeathQuote(text: string, firstName: string): string | null {
  const first = firstName.trim();
  if (!first) return null;
  const m = RELATIVE_DEATH.exec(text);
  if (!m) return null;
  const name = new RegExp(String.raw`\b${escapeRe(first)}\b`, "i");
  if (name.test(m[0])) return null;
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const signOff = lines.slice(-2).join(" ");
  // Signed BY the patient, not about them: "Love, Mele's daughter" or "Mele's son, Tom" is a relative writing.
  const signedBy = new RegExp(String.raw`\b${escapeRe(first)}\b(?!['’]s\b)`, "i");
  if (lines.length < 2 || !signedBy.test(signOff) || /\b(?:son|daughter|husband|wife|partner|carer|mum|dad|mother|father|brother|sister|child|kids|family) of\b/i.test(signOff)) return null;
  if (writesForSomeoneElse(text)) return null;
  return m[0].trim();
}

/** Where relativeDeathQuote found its words, for a rule hit. Null when it found none. */
export function relativeDeathHit(text: string, firstName: string): RuleHit | null {
  const quote = relativeDeathQuote(text, firstName);
  if (!quote) return null;
  const start = text.indexOf(quote);
  return { ruleId: RELATIVE_DEATH_RULE_ID, category: "bereavement", phrase: quote, start, end: start + quote.length };
}

/**
 * The rule id of the hit the pipeline adds when an earlier reply from the team already treats the patient as having
 * died ("I'm so sorry for your loss ... closing the account", MSG-0995). The team heard of the death by phone or in
 * another channel, so the conversation is a death report even when the newest message never says so.
 */
export const AGENT_DEATH_RULE_ID = "thread.agent.condolence";

/**
 * Condolence and account-closure words in a reply from the team: "sorry for your loss", "our condolences", "closing his
 * account". Only these are read in the team's own replies, never the whole safety lexicon (a reply may name a symptom
 * or a helpline).
 */
const AGENT_DEATH = /\b(?:sorry for (?:your|the family['’]s) loss|(?:my|our) (?:deepest |sincere |heartfelt )?condolences|condolences (?:to|on)|(?:deepest|heartfelt|sincere) sympathy|sorry to hear (?:that |of |about )?(?:\w+['’]s |your \w+['’]s )?(?:passing|death|passed away|has passed|died)|(?:closing|close|closed) (?:his|her|their) account|(?:on|after) (?:his|her|their) (?:death|passing))\b/i;

/** The condolence words in a reply from the team, as a hit with no position in the newest message. Null when none. */
export function agentDeathHit(body: string): RuleHit | null {
  const m = AGENT_DEATH.exec(body);
  return m ? { ruleId: AGENT_DEATH_RULE_ID, category: "bereavement", phrase: m[0], start: -1, end: -1 } : null;
}

const THREAD_PREFIX = /^thread\./;

function inThisMessage(hit: RuleHit): boolean {
  return hit.start >= 0 && !THREAD_PREFIX.test(hit.ruleId);
}

/**
 * True when the message mentions a death but reads as the living patient writing about someone else: a living-patient
 * hit in this message, or, when this message itself mentions no death, one in an earlier message of the conversation.
 * A death reported in THIS message with the living signal only in an earlier message stays a possible patient death
 * (a family member may be writing now).
 */
export function isLivingPatientReport(hits: readonly RuleHit[]): boolean {
  if (!hits.some((h) => h.category === "bereavement")) return false;
  const base = (h: RuleHit) => h.ruleId.replace(THREAD_PREFIX, "");
  const living = hits.filter((h) => LIVING_IDS.has(base(h)));
  if (living.some(inThisMessage)) return true;
  const deathHere = hits.some((h) => h.category === "bereavement" && inThisMessage(h));
  return !deathHere && living.length > 0;
}

/** The fields of a pipeline result (or a queue seed rebuilt as one) that decide the death reading. */
export interface DeathFacts {
  route: Route;
  rules: { hits: readonly RuleHit[] };
  sort?: { category: string };
}

/** Some part of the message mentions a death (a rule hit, or the sorter's verdict). */
export function mentionsDeath(result: DeathFacts): boolean {
  return result.rules.hits.some((h) => h.category === "bereavement") || result.sort?.category === "bereavement";
}

/**
 * The message may report the PATIENT's death: urgent, a death is mentioned, and nothing shows the writer is the living
 * patient. This alone decides the bereavement alert that withdraws every other reply to the patient (queue and eval).
 */
export function reportsPatientDeath(result: DeathFacts): boolean {
  return result.route === "urgent" && mentionsDeath(result) && !isLivingPatientReport(result.rules.hits);
}

/**
 * What a clinician's "false alarm" leaves standing. True when the message may report the patient's death AND carries
 * another safety reading (a side effect, say): the clear takes out the death reading, but the rest still needs a
 * clinician in touch, so the patient's other replies stay held "clinician first". False for a living patient's report
 * (the death was never the alert, so the clear releases everything, like any other false alarm) and for a death-only
 * report.
 */
export function falseAlarmKeepsAlert(result: DeathFacts): boolean {
  if (!reportsPatientDeath(result)) return false;
  const other = (c: string | undefined) => !!c && c !== "bereavement" && SAFETY.has(c);
  return result.rules.hits.some((h) => other(h.category)) || other(result.sort?.category);
}

/**
 * The stand-in hit a queue seed carries for a living patient's report (QueueSeed.livingPatient), so the queue rebuilt
 * in the browser reads the message exactly as the build did. Category bereavement, so it adds no safety category the
 * seed does not already carry (the seed's own categories say whether there is also an adverse event).
 */
export function livingPatientSeedHit(): RuleHit {
  return { ruleId: LIVING_PATIENT_RULE_ID, category: "bereavement", phrase: "", start: -1, end: -1 };
}

const SAFETY: ReadonlySet<string> = new Set<SafetyCategory>(["clinical_question", "side_effect", "adverse_event", "crisis", "bereavement"]);
