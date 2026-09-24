/**
 * The Care Desk pipeline: seven steps, always reported as seven trail entries in StepId order.
 *
 *   1 redact   personal details removed before any AI sees the text
 *   2 rules    deterministic safety rules on the ORIGINAL text (plus words in other languages, on every message); a
 *              safety hit stops the trail. A clinician-level stop is still checked by the sorter, which can only
 *              raise it to urgent, never lower it or draft
 *   3 sort     Claude sorts the redacted text; clinical or urgent stops the trail, low confidence goes to a person.
 *              When no sorter answers, a backup word check (no AI) is the second net before a person
 *   4 sources  the patient's records plus the most relevant policy sections
 *   5 draft    Claude drafts only when the route is still "draft"; a decline goes to a person
 *   6 check    every fact in the draft must be in the sources; a failure goes to a person, draft kept but blocked
 *   7 decide   a person sends, edits or escalates (or a clinician replies)
 *
 * Safety design: either layer can escalate, only both together can allow a draft, and any AI failure falls back to a
 * person (or, when the caller passes fallbackLlm, to the labelled demo-mode sample sorter and drafter).
 * Runs in Node, the browser and a Cloudflare Worker: no Node-only APIs.
 */
import type {
  Category,
  CheckResult,
  Country,
  Draft,
  OrderStatus,
  PatientMessage,
  Patient,
  PipelineResult,
  PolicySection,
  Route,
  RuleHit,
  SafetyCategory,
  SortResult,
  SourceRef,
  StepId,
  StepStatus,
  TrailStep,
  Usage,
} from "../types";
import { SAFETY_CATEGORIES } from "../types";
import policyData from "@/data/policy.json";
import { STEP_LABEL } from "../format";
import { conversationNames, redact, redactThread } from "./redact";
import { RULES_VERSION, aiInstructionHit, checkRules, routeForHits } from "./rules";
import { AGENT_DEATH_RULE_ID, LIVING_PATIENT_RULE_ID, RELATIVE_DEATH_RULE_ID, agentDeathHit, isLivingPatientReport, mentionsDeath, reportsPatientDeath } from "./death";
import { selectRecords, searchPolicy } from "./retrieve";
import { checkDraft, summariseCheck } from "./check";
import {
  LlmError,
  createClaudeClient,
  extractCitations,
  isMockModel,
  safetyNet,
  type LlmClient,
  type SafetyNetHit,
} from "./llm";
import { PROMPTS_VERSION } from "./prompts";

export interface RunOptions {
  apiKey?: string;
  llm?: LlmClient;
  /**
   * Used when the real client is missing (no key, deterministic_only mode) or fails as "unavailable", for example
   * createMockClient() for a VIP link or once the live box's spend cap is reached. Its results are labelled demo
   * mode in the trail, keep the model name it reports ("mock"), and set mode "deterministic_only".
   */
  fallbackLlm?: LlmClient;
  onStep?: (step: TrailStep) => void;
  mode?: "live" | "deterministic_only";
  confidenceThreshold?: number;
  /**
   * The same patient's other recent messages (separate conversations, any channel), for example from
   * recentMessagesFor(). Only the drafter sees them: each is redacted like the thread and added to its earlier messages
   * as a separate, labelled message, so a reply to "following on from my last email" knows what that email said
   * (MSG-0118 after MSG-0115). They are context, never a source, and never change the rules, the sorter or the route.
   * Messages from another patient, this message itself, and messages sent after it are ignored. So is any message the
   * deterministic rules would stop (withheldSeparateMessage: a safety hit, words aimed at the AI, not in English; a
   * plain stop-sending request is still shown), so the drafter never reads a crisis, a hospital visit or a death report
   * in a separate message. PipelineResult.recentMessageIds lists only the messages it was shown. The live box passes none.
   */
  recentMessages?: readonly PatientMessage[];
  /**
   * The date the records are read as of: pass the message's receivedAt. An open order past its estimated delivery date
   * on that day then carries a plain status line, "1 business day past its estimated delivery date ..." (lateOrderNote
   * in retrieve.ts), so a draft's "1 business day past" is a fact in the order it cites. Left out by the live box, whose
   * messages carry the real clock's time while the demo records stay in September 2026.
   */
  recordsAsOf?: string;
}

/** How far back recentMessagesFor looks, and how many of those messages it keeps (the newest). */
export const RECENT_MESSAGE_DAYS = 7;
export const RECENT_MESSAGE_LIMIT = 5;

/**
 * The same patient's other messages from the RECENT_MESSAGE_DAYS before this one (any channel), newest
 * RECENT_MESSAGE_LIMIT kept, oldest first. Pass only the messages this one may see (the desk slice or the red-team
 * slice): the pool is not filtered by slice here.
 */
export function recentMessagesFor(
  message: PatientMessage,
  pool: readonly PatientMessage[],
  days = RECENT_MESSAGE_DAYS,
  limit = RECENT_MESSAGE_LIMIT,
): PatientMessage[] {
  const at = Date.parse(message.receivedAt);
  if (Number.isNaN(at)) return [];
  return pool
    .filter((m) => {
      if (m.patientId !== message.patientId || m.id === message.id) return false;
      const t = Date.parse(m.receivedAt);
      return !Number.isNaN(t) && t < at && at - t <= days * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    .slice(-Math.max(0, limit));
}

/**
 * True when a separate message must never reach the drafter: the deterministic rules would stop it if it were run on
 * its own. That is a safety hit (clinical question, side effect, adverse event, crisis, bereavement) in its subject and
 * body, as written or as redacted (the drafter would read the redacted text), or in an earlier patient message of its
 * own conversation; condolences in a team reply there (the team may know the patient has died); words aimed at the AI
 * or the triage; or a message (or a line of one) mostly not in English, which the rules cannot read. A person and a
 * clinician follow such a message up, and a routine reply never mentions, summarises or promises a follow-up on it.
 * Round 3, P2: MSG-0944's draft said "The team will also follow up on your email from this morning" about MSG-0938 (a
 * crisis line rung twice); MSG-0950's mentioned "your chat about last night" (MSG-0949, a probable seizure).
 *
 * A plain "stop sending" request is still shown: it is not a safety stop (that message holds the orders itself), and it
 * is the context a follow-up needs. MSG-0118 ("Following on from my last email. Will I still be charged on 14
 * October?") is only answered correctly because the drafter can see that MSG-0115 asked to stop sending.
 */
export function withheldSeparateMessage(other: PatientMessage, redactedText: string, firstName?: string): boolean {
  const ruleOpts = { firstName };
  const safetyHit = (t: string) => checkRules(t, ruleOpts).hits.some((h) => h.category !== "stop_sending");
  for (const t of [messageText(other), redactedText]) {
    if (safetyHit(t) || aiInstructionHit(t)) return true;
  }
  for (const e of other.thread ?? []) {
    if (e.from === "patient" ? safetyHit(e.body) : agentDeathHit(e.body)) return true;
  }
  return looksNonEnglish(redactedText) || foreignLines(redactedText).length > 0;
}

/** "2 minutes", "3 hours", "4 days": how long before `later` the `earlier` ISO time was. */
function timeBefore(earlier: string, later: string): string {
  const mins = Math.max(0, Math.round((Date.parse(later) - Date.parse(earlier)) / 60000));
  if (mins < 60) return plural(Math.max(1, mins), "minute");
  const hours = Math.round(mins / 60);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.round(hours / 24), "day");
}

/**
 * The label in front of a separate message in the drafter's earlier messages. No date (the drafter does not work out
 * dates, and a date here is not a source) and no message id, only how long before this message it was sent.
 */
export function separateMessageLabel(other: PatientMessage, message: PatientMessage): string {
  const how = other.channel === "chat" ? "in a chat" : "by email";
  // prompts-v9: the second half keeps a reply to this message from answering, promising or restating the other one,
  // which gets its own reply (the paid run's review found about 25 drafts doing that). prompts-v10: the last sentence
  // lets a message that follows on from the other one name what it asked; under v9 alone MSG-0118 ("Following on from
  // my last email. Will I still be charged on 14 October?") no longer mentioned the stop request in MSG-0115 or the
  // refund rule for a plan paused before dispensing. Both changes sit here, so a message with no separate messages gets
  // exactly the prompt it had in v8.
  return `[A separate message from this patient, not part of this conversation: sent ${how} ${timeBefore(other.receivedAt, message.receivedAt)} before the message you are replying to. It gets its own reply. Use it only to understand this message: answer nothing in it that this message does not ask about, promise no follow-up on it, and state nothing from it as a fact. If this message follows on from it, you may say in a few words what the patient asked there, as their request and not as something done, and answer this message with that in mind.]`;
}

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

export const STEP_ORDER: readonly StepId[] = ["redact", "rules", "sort", "sources", "draft", "check", "decide"];

/** One vocabulary for step names: the same labels the UI uses (lib/format.ts). */
export const STEP_TITLES: Record<StepId, string> = STEP_LABEL;

/**
 * Appended to the sort and draft summaries when the built-in stand-in (the mock client) did the AI step. Named in the
 * same words as the UI (SAMPLE_STAND_IN in components/ui/SampleNotice.tsx).
 */
export const SAMPLE_RUN_NOTE = "Sample run: a simple built-in stand-in for Claude.";

const URGENT_CATEGORIES: readonly SafetyCategory[] = ["adverse_event", "crisis", "bereavement"];

/** Plain labels for the UI and trail summaries. */
export const CATEGORY_LABELS: Record<Category, string> = {
  order_status: "Order status",
  delivery_problem: "Delivery problem",
  script_renewal: "Script renewal",
  billing: "Billing",
  price_change: "Price change",
  plan_change: "Plan change",
  appointment: "Appointment",
  account_access: "Account access",
  product_question: "Product question",
  privacy_request: "Privacy request",
  complaint: "Complaint",
  wants_human: "Wants a person",
  other: "Other",
  clinical_question: "Clinical question",
  side_effect: "Side effect",
  adverse_event: "Adverse event",
  crisis: "Crisis language",
  bereavement: "Bereavement",
};

/** Categories that always go to a person, whatever the sorter says. */
const PERSON_CATEGORIES: readonly Category[] = ["wants_human", "complaint", "privacy_request", "other"];

/** Most serious first, so a message with several hits is labelled by the worst one. */
const SAFETY_PRIORITY: readonly SafetyCategory[] = [
  "crisis",
  "bereavement",
  "adverse_event",
  "side_effect",
  "clinical_question",
];

/**
 * The exact text the rules run on and that redaction starts from: the subject (email only) then the body.
 * Rule hit indices point into this string, so the UI should highlight against messageText(message).
 */
export function messageText(message: PatientMessage): string {
  return message.subject ? `${message.subject}\n\n${message.body}` : message.body;
}

export function isSafetyRoute(route: Route): boolean {
  return route === "clinician" || route === "urgent";
}

/** True when the trail was halted by the safety rules or by the sorter. */
export function isStopped(result: PipelineResult): boolean {
  return result.trail.some((s) => s.status === "stopped");
}

/** The step where the trail stopped, if it did. */
export function stoppedAt(result: PipelineResult): StepId | undefined {
  return result.trail.find((s) => s.status === "stopped")?.id;
}

/** True when an agent can send the draft after reviewing it: route draft and the fact check passed. */
export function isReadyToSend(result: PipelineResult): boolean {
  return result.route === "draft" && !!result.draft?.text && result.check?.passed === true;
}

/** True when the fact check blocked a draft (the draft is kept for the agent to see, but cannot be sent as is). */
export function isDraftBlocked(result: PipelineResult): boolean {
  return !!result.draft?.text && result.check?.passed === false;
}

/** True when the sample sorter or drafter (demo mode) produced any part of the result. */
export function isDemoMode(result: PipelineResult): boolean {
  return isMockModel(result.models.sort) || isMockModel(result.models.draft);
}

/**
 * Most serious safety category among rule hits (ignores stop_sending). In a living patient's report (a death is
 * mentioned, but the writer is the patient using their own treatment, lib/pipeline/death.ts) bereavement never leads:
 * the patient's own care does, so every screen labels MSG-0172 an adverse event.
 */
export function worstSafetyCategory(hits: RuleHit[]): SafetyCategory | undefined {
  const cats = new Set(hits.map((h) => h.category));
  const living = isLivingPatientReport(hits);
  if (living) cats.delete("bereavement");
  // A patient writing about a relative's death with nothing else to flag (MSG-0120): the death still names the stop.
  return SAFETY_PRIORITY.find((c) => cats.has(c)) ?? (living ? "bereavement" : undefined);
}

// ---------- Headline: which rule hit names the stop ----------

/** Generic clinical phrases: they escalate on purpose, but they say little about what the patient asked. */
const GENERIC_MIX = /^(?:is it (?:ok|okay|safe|alright|all right|fine) (?:to|if|for)|safe (?:to|with|for|while)|alongside|together with)$/i;

/** Rule-specific weights, by rule id without any "thread." prefix. Anything not listed uses its category default. */
const RULE_WEIGHT: Record<string, number> = {
  "crisis.idiom_dying": 5,
  "crisis.idiom_kill_me": 5,
  "bereavement.rip": 50,
  "bereavement.passed": 60,
  "adverse.ed_ae": 60,
  // "taking more of my oil than I'm meant to" says more than "I've been taking more".
  "adverse.more_than": 85,
  // The living-patient hit names the case only when nothing more specific (the overuse words) was found.
  [LIVING_PATIENT_RULE_ID]: 30,
  "side_effect.worse": 60,
  "clinical.named_medicine": 100,
  "clinical.interaction": 95,
  "clinical.pregnancy": 90,
  "clinical.driving": 85,
  "clinical.other_medication": 80,
  "clinical.alcohol": 80,
  "clinical.machinery": 80,
  "clinical.sharing": 80,
  "clinical.conditions": 75,
  "clinical.stop_taking": 75,
  "clinical.travel": 70,
  "clinical.more_less": 70,
  "clinical.how_much": 60,
  "clinical.dose": 40,
};

const CATEGORY_WEIGHT: Record<string, number> = {
  crisis: 90,
  bereavement: 80,
  adverse_event: 80,
  side_effect: 70,
  clinical_question: 50,
  stop_sending: 0,
};

/**
 * How specific a hit is, 0 to 100: a named medicine or a symptom says more than "is it ok to" or a bare "mg".
 * Used only to choose the headline and to tell a clinical question from a side effect; routing never depends on it.
 */
export function hitSpecificity(hit: RuleHit): number {
  const id = hit.ruleId.replace(/^thread\./, "");
  const phrase = hit.phrase.replace(/\s+/g, " ").trim();
  if (id === "side_effect.named" && /^reactions?$/i.test(phrase)) return 30;
  if (id === "side_effect.heart" && /blood pressure/i.test(phrase)) return 15; // a condition or a medicine, not a symptom
  if (id === "clinical.mix_with") return GENERIC_MIX.test(phrase) ? 35 : 85;
  if (id === "clinical.thc") return /mg$/i.test(phrase) ? 20 : 50;
  return RULE_WEIGHT[id] ?? CATEGORY_WEIGHT[hit.category] ?? 50;
}

function bySpecificity(a: RuleHit, b: RuleHit): number {
  // Most specific first; then the latest message before earlier ones, the first mention, and the longer phrase.
  return (
    hitSpecificity(b) - hitSpecificity(a) ||
    (a.start < 0 ? Number.MAX_SAFE_INTEGER : a.start) - (b.start < 0 ? Number.MAX_SAFE_INTEGER : b.start) ||
    b.phrase.length - a.phrase.length
  );
}

/**
 * The category that names a rules stop. Crisis, bereavement and adverse events keep their severity order. Between a
 * side effect and a clinical question (both go to a clinician) the most specific hit decides, so "blood pressure
 * tablets ... is it ok to take alongside" reads as a clinical question, not a side effect.
 */
export function headlineCategory(hits: RuleHit[]): SafetyCategory | undefined {
  const safety = hits.filter((h) => h.category !== "stop_sending");
  const worst = worstSafetyCategory(safety);
  if (worst !== "side_effect" && worst !== "clinical_question") return worst;
  const best = safety.filter((h) => h.category === "side_effect" || h.category === "clinical_question").sort(bySpecificity)[0];
  return (best?.category as SafetyCategory | undefined) ?? worst;
}

/** The single hit to quote in the stop summary: the most specific hit in the headline category. */
export function headlineHit(hits: RuleHit[]): RuleHit | undefined {
  const cat = headlineCategory(hits);
  if (!cat) return undefined;
  return hits.filter((h) => h.category === cat).sort(bySpecificity)[0];
}

/**
 * The category the pipeline settled on: the sorter's when it ran, otherwise the headline rule category.
 * A clinician or urgent result always carries a safety category, even when the sorter escalated with a routine label
 * ("Other, but not in English", or risk urgent with category other): the headline rule category when there is one,
 * else the one the pipeline used for the clinician's context (adverse_event for urgent, clinical_question otherwise).
 * A result withdrawn by applyPatientHolds keeps its own routine category.
 * Undefined when neither is known (for example, AI unavailable and no rule hit).
 */
export function resultCategory(result: PipelineResult): Category | undefined {
  const own = result.sort?.category ?? headlineCategory(result.rules.hits);
  if (!isSafetyRoute(result.route) || (own && isSafetyCategory(own)) || isWithdrawn(result)) return own;
  return headlineCategory(result.rules.hits) ?? (result.route === "urgent" ? "adverse_event" : "clinical_question");
}

// ---------- Language check ----------

/** Common English function words. A message in English almost always has plenty of them. */
const ENGLISH_WORDS = new Set(
  (
    "the a an and or but if so as at by for from in into of on to up out off over with about after before again all any " +
    "some more most no not nor only own same than too very just also still yet then there here now once when where why " +
    "how what which who whom this that these those i me my mine myself you your yours we us our they them their he him " +
    "his she her it its is are was were be been being am have has had do does did done can could will would shall " +
    "should may might must im ive id dont cant wont didnt doesnt isnt wasnt havent hasnt please thanks thank hi hello dear " +
    "yes ok okay get got know need want like one two new last next today week"
  ).split(" "),
);

/** Greetings and sign-offs from te reo Maori, Welsh and elsewhere that are normal inside an English message. */
const GREETINGS = new Set("kia ora koutou e hoa nga mihi ngā tena koe tēnā diolch ta cheers bore da shwmae aroha nui mauri".split(" "));

/**
 * Medicine-like words in other languages: any of these sends a message mostly not in English to a clinician. Some are
 * also English stems ("medica" in "medication", "hospital", "alcohol"), so an English message uses the strict list.
 */
const FOREIGN_MEDICINE =
  /medica|medik|m[eé]dic|farmac|pharmak|pastill|tablett|comprim|p[ií]ldora|dosis|dosi\b|presi[oó]n|pression|blutdruck|embaraz|schwanger|enceinte|incinta|gr[aá]vida|alcohol|alkohol|efect|effet|nebenwirk|mareo|schwindel|dolor|douleur|schmerz|hospital|krankenhaus|h[oô]pital|urgenc|notfall/i;

/**
 * Medicine words in other languages that are never English words, checked on every message, so a phrase in another
 * language inside an English message ("can I take it with mi medicación?") still reaches a clinician.
 */
const FOREIGN_MEDICINE_STRICT =
  /(?<!\p{L})(?:medicaci[oó]n\p{L}*|medikament\p{L}*|m[eé]dicament\p{L}*|farmac[io]\p{L}*|pharmak\p{L}*|pastill\p{L}*|tablette\p{L}*|comprim[eé]\p{L}*|comprimid\p{L}*|p[ií]ldora\p{L}*|dosis|presi[oó]n|blutdruck|embarazada|schwanger|enceinte|incinta|gr[aá]vida|nebenwirk\p{L}*|efectos?|effet secondaire|mareo\p{L}*|schwindel\p{L}*|dolor|douleur|schmerz\p{L}*|krankenhaus|h[oô]pital|notfall|rongo[aā]|w[eē]kau|meddyginiaeth|tabledi|beichiog)(?!\p{L})/iu;

/** The medicine-word hit for a message: the broad list when it is mostly not in English, else the strict list. */
function foreignMedicineHit(text: string, nonEnglish: boolean): { phrase: string; index: number } | undefined {
  const m = (nonEnglish ? FOREIGN_MEDICINE : FOREIGN_MEDICINE_STRICT).exec(text);
  return m ? { phrase: m[0], index: m.index } : undefined;
}

/**
 * Crisis, death and serious-reaction words in Spanish, German, French, Italian, Portuguese, Polish, te reo Maori and
 * Welsh. The safety rules are written for English, so every message is checked against these too (a patient may
 * switch languages mid-message); any hit is urgent.
 * Letters are matched with Unicode-aware edges, because \b does not treat "ó" or "ü" as part of a word.
 */
const FOREIGN_URGENT: { category: SafetyCategory; re: RegExp }[] = [
  {
    category: "crisis",
    re: /(?<!\p{L})(?:ki te mate|whakamomori\p{L}*|kia mate ahau|lladd fy hun|eisiau marw|morir(?:me)?|matarme|quitarme la vida|no puedo m[aá]s|suicid\p{L}*|selbstmord\p{L}*|umbringen|sterben|me (?:tuer|suicider)|mourir|morire|uccidermi|ammazzarmi|farla finita|me matar|n[aã]o aguento mais|no quiero (?:seguir )?vivir|non voglio (?:pi[uù] )?vivere|je ne veux plus vivre|en finir|will nicht mehr leben|n[aã]o quero (?:mais )?viver|nie chc[eę] (?:ju[zż] )?[zż]y[cć]|zabi[cć] si[eę]|umrze[cć]|odebra[cć] sobie [zż]ycie)(?!\p{L})/iu,
  },
  {
    category: "bereavement",
    re: /(?<!\p{L})(?:kua mate|kua hemo|wedi marw|falleci\p{L}*|muri[oó]|verstorben\p{L}*|gestorben|d[ée]c[ée]d[ée]e?s?|morto|morta|morreu|faleceu|faleci\p{L}*|deceduto|deceduta|[eè] mort[oa]|scompars[oa]|zmar[lł]a?|nie [zż]yje)(?!\p{L})/iu,
  },
  {
    category: "adverse_event",
    re: /(?<!\p{L})(?:zu viel|demasiado|trop pris|troppo|urgencias|notaufnahme|krankenhaus|ambulanc\p{L}*|krankenwagen|h[oô]pital|ospedale|pronto soccorso|hospital|convulsi\p{L}*|krampfanfall|szpital\p{L}*|karetk\p{L}*|pogotowi\p{L}*)(?!\p{L})/iu,
  },
];

const FOREIGN_WHAT: Record<SafetyCategory, string> = {
  crisis: "self-harm or danger",
  bereavement: "a death",
  adverse_event: "a serious reaction",
  side_effect: "a side effect",
  clinical_question: "medicine",
};

/** What the backup word check found, in plain words: "found a possible serious reaction". */
const BACKUP_WHAT: Record<SafetyCategory, string> = {
  crisis: "possible crisis language",
  bereavement: "a possible death",
  adverse_event: "a possible serious reaction",
  side_effect: "a possible side effect",
  clinical_question: "a clinical question",
};

/**
 * A child or pet swallowing a product, in the same languages: a family word near a word for drinking, eating or
 * swallowing. Always urgent (an adverse event).
 */
const FOREIGN_INGESTION =
  /(?<!\p{L})(?:figli[oa]|bambin[oa]|hij[oa]|ni[nñ][oa]|sohn|tochter|kind|fils|fille|enfant|b[eé]b[eé]|filh[oa]|crian[cç]a|syn|c[oó]rka|dziecko|perro|cane|hund|chien|cachorro|pies)(?!\p{L})[^.?!]{0,60}(?<!\p{L})(?:ha bevuto|ha mangiato|ha ingerito|bebi[oó]|tom[oó]|comi[oó]|trag[oó]|getrunken|gegessen|verschluckt|a bu|a aval[eé]|a mang[eé]|bebeu|comeu|engoliu|wypi[lł]a?|zjad[lł]a?|po[lł]kn[aą][lł]a?)(?!\p{L})/iu;

/** Words in the lists above that are also English. In an English message the English safety rules own them. */
const ENGLISH_TOO = /^(?:hospital|ambulance|ambulances)$/i;

/**
 * The most serious foreign-language safety hit, if any (crisis, then bereavement, then adverse event). In a message
 * that is mostly English, words that are English too ("hospital") are left to the English rules.
 */
function foreignUrgentHit(text: string, nonEnglish: boolean): { category: SafetyCategory; phrase: string; index: number } | undefined {
  for (const r of FOREIGN_URGENT) {
    if (r.category === "adverse_event") {
      const child = FOREIGN_INGESTION.exec(text);
      if (child) return { category: "adverse_event", phrase: child[0], index: child.index };
    }
    for (const m of text.matchAll(new RegExp(r.re.source, `${r.re.flags}g`))) {
      if (!nonEnglish && ENGLISH_TOO.test(m[0])) continue;
      return { category: r.category, phrase: m[0], index: m.index ?? 0 };
    }
  }
  return undefined;
}

/** A rule hit for the foreign-language checks, so the UI and patient-level holds read it like any other rule. */
function foreignHit(category: SafetyCategory, phrase: string, index: number): RuleHit {
  return { ruleId: `foreign.${category}`, category, phrase, start: index, end: index < 0 ? -1 : index + phrase.length };
}

/**
 * The lines of a message that are mostly not in English on their own (see looksNonEnglish). A line needs at least eight
 * words, so a subject line ("Formal complaint: repeated payment failures") never counts, and a line in capitals is
 * left out, because shouted English has few of the small words the check counts.
 */
export function foreignLines(text: string): string[] {
  return text.split(/\n+/).filter((line) => {
    if (!/\p{Ll}/u.test(line)) return false;
    const words = line.split(/[^\p{L}]+/u).filter(Boolean).length;
    return words >= 8 && looksNonEnglish(line);
  });
}

/**
 * True when a message is mostly not in English: at least five words, and fewer than 15% of them common English words
 * (placeholders, ids, numbers and greetings such as "kia ora" or "diolch" are ignored).
 */
export function looksNonEnglish(text: string): boolean {
  const tokens = text
    .replace(/\[[A-Z_ ]+\]/g, " ")
    .replace(/\b[A-Z]{2,4}-?\d+\b/g, " ")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}]+/u)
    .filter((t) => t.length > 0 && !GREETINGS.has(t));
  if (tokens.length < 5) return false;
  const english = tokens.filter((t) => ENGLISH_WORDS.has(t)).length;
  return english / tokens.length < 0.15;
}

// ---------- helpers ----------

/** Where a hit from outside the newest message was found: an earlier patient message, or an earlier reply from the team. */
function earlierWhere(hit: RuleHit): string {
  if (hit.start >= 0) return "";
  return hit.ruleId === AGENT_DEATH_RULE_ID ? " in an earlier reply from the team" : " in an earlier message";
}

function isToneGuide(s: SourceRef): boolean {
  return s.kind === "policy" && /(tone|voice)/i.test(s.label);
}

function isSafetyCategory(c: Category): c is SafetyCategory {
  return (SAFETY_CATEGORIES as readonly string[]).includes(c);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function addUsage(a: Usage, b: Usage | undefined): Usage {
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function quote(s: string, max = 40): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return `"${flat.length > max ? `${flat.slice(0, max).trimEnd()}...` : flat}"`;
}

const CLOSED_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["delivered", "cancelled"]);

/**
 * An order record that a hold still affects (not delivered or cancelled). Decided from the patient's structured order
 * status; the record text is only a fallback for an order the patient record does not hold.
 */
function isOpenOrder(s: SourceRef, patient: Patient): boolean {
  if (s.kind !== "order") return false;
  const order = (patient.orders ?? []).find((o) => o.id === s.id);
  if (order) return !CLOSED_ORDER_STATUSES.has(order.status);
  return !/(?:^|[:;])\s*status (?:delivered|cancelled)\b/.test(s.text);
}

// ---------- Safety protocols attached after a stop ----------

function policySections(data: unknown): PolicySection[] {
  if (Array.isArray(data)) return data as PolicySection[];
  const s = (data as { sections?: unknown } | null)?.sections;
  return Array.isArray(s) ? (s as PolicySection[]) : [];
}

const POLICY_BY_ID = new Map(policySections(policyData).map((p) => [p.id, p]));

/** The clinical protocol every clinician or urgent stop carries. */
export const CLINICAL_PROTOCOL_ID = "P10.1";

/** The urgent-safety protocol (adverse events, crisis, bereavement) for each country. */
export const URGENT_PROTOCOL_ID: Record<Country, string> = { AU: "P10.2", NZ: "P10.3", UK: "P10.4" };

function policyRef(id: string): SourceRef | undefined {
  const p = POLICY_BY_ID.get(id);
  return p ? { id: p.id, kind: "policy", label: `Policy ${p.id}: ${p.title}`, text: p.body } : undefined;
}

/**
 * The protocols a clinician needs after a stop, chosen by id so they never depend on the message's wording:
 * the country's urgent-safety protocol first for an urgent stop (crisis, bereavement, adverse event or any urgent
 * route), then the clinical protocol P10.1 for every stop.
 */
export function safetyProtocolIds(category: SafetyCategory, route: Route, country: Country): string[] {
  const urgent = route === "urgent" || URGENT_CATEGORIES.includes(category);
  return urgent ? [URGENT_PROTOCOL_ID[country], CLINICAL_PROTOCOL_ID] : [CLINICAL_PROTOCOL_ID];
}

function safetyProtocols(category: SafetyCategory, route: Route, country: Country): SourceRef[] {
  return safetyProtocolIds(category, route, country)
    .map(policyRef)
    .filter((p): p is SourceRef => !!p);
}

export async function runPipeline(
  message: PatientMessage,
  patient: Patient,
  opts: RunOptions = {},
): Promise<PipelineResult> {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const trail: TrailStep[] = [];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const models: PipelineResult["models"] = {};
  let mode: PipelineResult["mode"] = opts.mode ?? "live";

  const emit = (id: StepId, status: StepStatus, summary: string, ms?: number) => {
    const step: TrailStep = { id, status, title: STEP_TITLES[id], summary };
    if (ms !== undefined) step.ms = Math.max(0, Math.round(ms));
    trail.push(step);
    opts.onStep?.(step);
  };
  const skipRest = (reason: string, summaries: Partial<Record<StepId, string>> = {}) => {
    for (const id of STEP_ORDER) {
      if (id === "decide") break;
      if (!trail.some((s) => s.id === id)) emit(id, "skipped", summaries[id] ?? reason);
    }
  };

  // ---- 1. Redact ----
  let t = now();
  const original = messageText(message);
  // The same patient's other recent messages, for the drafter only (RunOptions.recentMessages): the subject is written
  // out as "Subject:", so the drafter can tell it from the body. A separate message the deterministic rules would stop
  // (withheldSeparateMessage) is never shown, so a routine reply can never mention a crisis, a hospital visit or a death
  // (rehearsal round 3, P2: MSG-0944 after MSG-0938, MSG-0950 after MSG-0949, MSG-0948 after MSG-0908).
  const candidates = recentMessagesFor(message, opts.recentMessages ?? [], Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
    .filter((m) => !(message.thread ?? []).some((e) => e.from === "patient" && e.body.trim() === m.body.trim()))
    .map((m) => ({ message: m, text: m.subject ? `Subject: ${m.subject}\n\n${m.body}` : m.body }));
  const candidateNames = conversationNames([...(message.thread ?? []), ...candidates.map((o) => ({ body: o.text }))], original, patient);
  // Read as the pipeline would read that message on its own: its subject and body (messageText), as written and redacted.
  const others = candidates.filter(
    (o) =>
      !withheldSeparateMessage(o.message, redact(messageText(o.message), patient, { names: candidateNames }).redactedText, patient.firstName),
  );
  // A name written anywhere in the conversation ("Thanks, Karen" in an earlier message) is hidden everywhere in it, and
  // in the separate messages the drafter is shown with it.
  const names = conversationNames([...(message.thread ?? []), ...others.map((o) => ({ body: o.text }))], original, patient);
  const { redactedText, redactions } = redact(original, patient, { names });
  // With separate messages the thread is redacted with the wider name list, so a name found only in one of them is
  // hidden here too. Without them this is exactly redactThread.
  const thread =
    others.length > 0
      ? (message.thread ?? []).map((e) => ({ from: e.from, body: redact(e.body, patient, { names }).redactedText }))
      : redactThread(message.thread, patient, original);
  /** The drafter's earlier messages: the separate recent messages first (labelled, oldest first), then this thread. */
  const draftThread = [
    ...others.map((o) => ({
      from: "patient" as const,
      body: `${separateMessageLabel(o.message, message)}\n${redact(o.text, patient, { names }).redactedText}`,
    })),
    ...thread,
  ];
  /** The message and its earlier thread, redacted: records the patient names by id ("ORD-20019") are always included. */
  const recordText = [redactedText, ...thread.map((e) => e.body)].join("\n");
  const hidden = redactions.reduce((n, r) => n + r.count, 0);
  emit(
    "redact",
    "passed",
    hidden > 0 ? `${plural(hidden, "detail")} hidden before any AI step` : "No personal details found to hide",
    now() - t,
  );

  // ---- 2. Safety rules (original text, plus earlier patient messages in the thread) ----
  t = now();
  // The patient's first name lets the rules tell a patient writing about a relative's death (signed with their own
  // name) from a relative reporting the patient's death (lib/pipeline/death.ts).
  const ruleOpts = { firstName: patient.firstName };
  const rules: { matched: boolean; hits: RuleHit[] } = checkRules(original, ruleOpts);
  const hits: RuleHit[] = [...rules.hits];
  for (const e of message.thread ?? []) {
    if (e.from !== "patient") {
      // A reply from the team is read only for condolences ("sorry for your loss", MSG-0995): the team may already know
      // the patient has died, though the newest message never says so.
      const agentDeath = agentDeathHit(e.body);
      if (agentDeath && !hits.some((h) => h.ruleId === agentDeath.ruleId)) hits.push(agentDeath);
      continue;
    }
    const earlier: { hits: RuleHit[] } = checkRules(e.body, ruleOpts);
    // Hits in earlier messages have no position in this message's text, so their indices are -1.
    // Only safety hits count from earlier messages; an old "stop sending" has already been dealt with.
    for (const h of earlier.hits) {
      if (h.category !== "stop_sending") hits.push({ ...h, ruleId: `thread.${h.ruleId}`, start: -1, end: -1 });
    }
  }
  const safetyHits = hits.filter((h) => h.category !== "stop_sending");
  const stopSending = rules.hits.some((h) => h.category === "stop_sending");
  const ruleRouting = routeForHits(hits);
  const rulesResult = { matched: rules.matched || safetyHits.length > 0, hits };
  /** Mostly not in English as a whole. */
  const wholeForeign = looksNonEnglish(redactedText);
  /**
   * Lines written mostly in another language inside an English message (MSG-0968: an order question, then "this next
   * part is easier for me to write in Vietnamese"). The rules only read English, so such a message is treated like one
   * not in English: never drafted, a clinician checks it, orders held meanwhile.
   */
  const foreignParts = wholeForeign ? [] : foreignLines(redactedText);
  const nonEnglish = wholeForeign || foreignParts.length > 0;
  /** Words aimed at the AI or the triage, anywhere in the message (subject included): at least a person reads it. */
  const aiInstruction = aiInstructionHit(original);

  let route: Route = "draft";
  let holdOrders = stopSending;
  let sort: SortResult | undefined;
  let sources: PipelineResult["sources"];
  let draft: Draft | undefined;
  let check: CheckResult | undefined = undefined;
  /** Set once the drafter is given the separate recent messages (PipelineResult.recentMessageIds). */
  let recentMessageIds: string[] | undefined;

  const finish = (): PipelineResult => {
    let decideSummary: string;
    if (route === "urgent") decideSummary = "Urgent: waiting for a clinician. Orders are on hold.";
    else if (route === "clinician")
      decideSummary = holdOrders ? "Waiting for a clinician to reply. Orders are on hold." : "Waiting for a clinician to reply";
    else if (route === "draft") decideSummary = "Waiting for a person to send, edit or escalate";
    else decideSummary = holdOrders ? "Waiting for a person to reply. Orders are on hold." : "Waiting for a person to write the reply";
    emit("decide", "pending", decideSummary);
    return {
      messageId: message.id,
      redactedText,
      redactions,
      rules: rulesResult,
      sort,
      sources,
      draft,
      check,
      route,
      holdOrders,
      trail,
      models,
      usage,
      versions: { rules: RULES_VERSION, prompts: PROMPTS_VERSION },
      mode,
      ...(recentMessageIds ? { recentMessageIds } : {}),
    };
  };

  /**
   * After a safety stop there is no AI reply, but the clinician still needs context: the patient's open orders (the
   * ones a hold affects), any record the patient names, the latest appointment and plan, and the clinical and
   * urgent-safety protocols for their country, attached by id (see safetyProtocolIds).
   * Deterministic, no AI involved. The sources step stays "skipped" (no reply is drafted), with the facts attached.
   */
  const safetyContext = (category: SafetyCategory): string => {
    const records = selectRecords(patient, category, recordText, { asOf: opts.recordsAsOf });
    const policy = safetyProtocols(category, route, patient.country);
    sources = { records, policy };
    const open = records.filter((r) => isOpenOrder(r, patient)).length;
    if (holdOrders) {
      return open > 0
        ? `No reply to draft. ${plural(open, "open order")} affected by the hold.`
        : "No reply to draft. No open orders to hold.";
    }
    return `No reply to draft. ${plural(records.length, "record")} kept for the clinician.`;
  };

  // ---- The sorter, shared by step 3 and by the escalation check after a clinician-level stop ----
  let primary: LlmClient | undefined;
  let primaryChecked = false;
  /** The real client, created on first use. With none (no key, or deterministic_only) the mode is deterministic_only. */
  const getPrimary = (): LlmClient | undefined => {
    if (primaryChecked) return primary;
    primaryChecked = true;
    if (mode !== "deterministic_only") {
      try {
        primary = opts.llm ?? (opts.apiKey ? createClaudeClient(opts.apiKey) : undefined);
      } catch {
        primary = undefined;
      }
      if (!primary) mode = "deterministic_only";
    }
    return primary;
  };
  const fallback = opts.fallbackLlm;
  /** The client that sorted, and that will draft: the real one, or the demo-mode fallback. */
  let llm: LlmClient | undefined;
  let sortNote = "";

  const trySort = async (client: LlmClient): Promise<SortResult> => {
    const out = await client.sort({ text: redactedText, channel: message.channel, country: patient.country, thread });
    usage = addUsage(usage, out.usage);
    models.sort = out.model;
    llm = client;
    if (isMockModel(out.model)) {
      mode = "deterministic_only";
      sortNote = ` ${SAMPLE_RUN_NOTE}`;
    }
    return out.sort;
  };
  const sortFailed = (err: unknown): LlmError | undefined => {
    const e = err instanceof LlmError ? err : undefined;
    usage = addUsage(usage, e?.usage);
    if (e?.model) models.sort = e.model;
    return e;
  };

  /**
   * Sorts with the real client, or with the labelled demo-mode fallback when the real one is missing or unavailable.
   * `attempted` is false when there was no client at all. On failure, `failure` says why (undefined for a non-LlmError).
   */
  const runSort = async (): Promise<{ result?: SortResult; failure?: LlmError; attempted: boolean }> => {
    const first = getPrimary();
    if (!first && !fallback) return { attempted: false };
    let failure: LlmError | undefined;
    let failed = false;
    let result: SortResult | undefined;
    if (first) {
      try {
        result = await trySort(first);
      } catch (err) {
        failure = sortFailed(err);
        failed = true;
      }
    }
    const unavailable = !first || (failed && (!failure || failure.kind === "unavailable"));
    if (unavailable && fallback) {
      mode = "deterministic_only";
      try {
        result = await trySort(fallback);
        failed = false;
        failure = undefined;
      } catch (err) {
        failure = sortFailed(err);
        failed = true;
      }
    }
    if (failed && failure?.kind !== "invalid_output" && failure?.kind !== "refusal") mode = "deterministic_only";
    return failed ? { failure, attempted: true } : { result, attempted: true };
  };

  /**
   * The backup word check (the sample sorter's safety words, no AI): urgent and clinician words on the original message
   * and the earlier patient messages, then the "closer look" words on the redacted text. Used whenever no sorter answered.
   */
  const backupNet = (): SafetyNetHit | undefined => {
    const rank = (x: SafetyNetHit | undefined) => (x?.level === "urgent" ? 3 : x?.level === "clinician" ? 2 : 0);
    let best: SafetyNetHit | undefined;
    const own = safetyNet(original);
    if (rank(own) > 0) best = own;
    for (const e of message.thread ?? []) {
      if (e.from !== "patient") continue;
      const x = safetyNet(e.body);
      if (rank(x) > rank(best)) best = x && { ...x, index: -1 };
    }
    if (best) return best;
    const concern = safetyNet(redactedText);
    return concern?.level === "concern" ? { ...concern, index: -1 } : undefined;
  };
  const backupHit = (net: SafetyNetHit): RuleHit => ({
    ruleId: `backup.${net.category}`,
    category: net.category as SafetyCategory,
    phrase: net.phrase,
    start: net.index,
    end: net.index < 0 ? -1 : net.index + net.phrase.length,
  });

  const sortIsUrgent = (s: SortResult) =>
    s.route === "urgent" || s.risk === "urgent" || URGENT_CATEGORIES.includes(s.category as SafetyCategory);

  /**
   * After a clinician-level stop (a side effect, a clinical question, medicine words in another language) the message
   * is checked once more for anything urgent: by the sorter on the redacted text or, when no sorter answers, by the
   * backup word check. Either can only RAISE the stop to urgent with orders on hold. Nothing here lowers the route,
   * and no reply is ever drafted after a stop.
   */
  const raiseIfUrgent = async (): Promise<void> => {
    t = now();
    const { result, attempted } = await runSort();
    if (result) {
      const pct = `${Math.round(result.confidence * 100)}% sure`;
      if (sortIsUrgent(result)) {
        route = "urgent";
        holdOrders = true;
        sort = result;
        emit(
          "sort",
          "flagged",
          `Raised to urgent: the sorter reads this as ${CATEGORY_LABELS[result.category]} (${pct}). Orders on hold.${sortNote}`,
          now() - t,
        );
      } else {
        emit("sort", "passed", `Checked for anything more urgent: nothing found, so it stays with a clinician.${sortNote}`, now() - t);
      }
      return;
    }
    const net = backupNet();
    if (net?.level === "urgent" && net.category) {
      route = "urgent";
      holdOrders = true;
      hits.push(backupHit(net));
      emit(
        "sort",
        "flagged",
        `Raised to urgent: the backup word check found ${BACKUP_WHAT[net.category]} (${quote(net.phrase)}). Orders on hold.`,
        now() - t,
      );
      return;
    }
    if (attempted) {
      emit("sort", "flagged", "The AI could not check this one for anything more urgent, so it stays with a clinician", now() - t);
    }
  };

  /** The urgent category after a raise: the sorter's, or the backup word check's, else a serious reaction. */
  const raisedCategory = (): SafetyCategory => {
    const s = sort as SortResult | undefined;
    if (s && URGENT_CATEGORIES.includes(s.category as SafetyCategory)) return s.category as SafetyCategory;
    const backup = hits.find((x) => x.ruleId.startsWith("backup.") && URGENT_CATEGORIES.includes(x.category as SafetyCategory));
    return (backup?.category as SafetyCategory | undefined) ?? "adverse_event";
  };

  /** A clinician-level stop at the rules step: the escalation check runs, then the rest of the trail is skipped. */
  const clinicianStop = async (category: SafetyCategory, summary: (holding: boolean) => string): Promise<PipelineResult> => {
    emit("rules", "stopped", summary(holdOrders), now() - t);
    await raiseIfUrgent();
    const sourcesSummary = safetyContext(route === "urgent" ? raisedCategory() : category);
    skipRest("Skipped: the safety rules stopped this message", { sources: sourcesSummary });
    return finish();
  };

  // Words in another language are checked on EVERY message, not only on one mostly in another language: a patient may
  // switch languages mid-message ("sorry my english, quiero morir"). Checked on the original text, like the rules.
  const foreign = foreignUrgentHit(original, wholeForeign);
  // The broad medicine list (it shares stems with English words) reads only the parts not in English.
  const partMedicine = foreignParts.length > 0 ? foreignMedicineHit(foreignParts.join(" "), true) : undefined;
  const medicine = foreignMedicineHit(original, wholeForeign) ?? (partMedicine && { ...partMedicine, index: -1 });
  const languageNote = wholeForeign ? "Not in English, and it" : "Part of it is in another language, and it";
  const notEnglishNote = wholeForeign ? "the message is not in English" : "part of the message is not in English";

  if (ruleRouting?.route === "urgent" && safetyHits.length > 0) {
    route = "urgent";
    holdOrders = true;
    const category = headlineCategory(safetyHits) ?? "adverse_event";
    const best = headlineHit(safetyHits) ?? safetyHits[0];
    const where = earlierWhere(best);
    // A death that is not the headline: say so, and whose care comes first when the writer is the living patient.
    const deathNote =
      category === "bereavement" && isLivingPatientReport(safetyHits)
        ? " It reads as the patient writing about someone close to them, so their other replies wait for a clinician rather than being withdrawn."
        : category === "bereavement" || !mentionsDeath({ route, rules: { hits: safetyHits } })
        ? ""
        : isLivingPatientReport(safetyHits)
          ? " It also mentions a death, but the writer is using their own treatment, so it is handled as the patient's own care."
          : " It also mentions a death.";
    emit(
      "rules",
      "stopped",
      `${CATEGORY_LABELS[category]}: ${quote(best.phrase)}${where}.${deathNote} Sent to a clinician as urgent, no AI reply, orders on hold.`,
      now() - t,
    );
    const sourcesSummary = safetyContext(category);
    skipRest("Skipped: the safety rules stopped this message", { sources: sourcesSummary });
    return finish();
  }

  // Crisis, death or serious-reaction words in another language are urgent, whatever the English rules found.
  if (foreign) {
    route = "urgent";
    holdOrders = true;
    hits.push(foreignHit(foreign.category, foreign.phrase, foreign.index));
    rulesResult.matched = true;
    emit(
      "rules",
      "stopped",
      `${languageNote} may be about ${FOREIGN_WHAT[foreign.category]}: ${quote(foreign.phrase)}. Sent to a clinician as urgent, no AI reply, orders on hold.`,
      now() - t,
    );
    const sourcesSummary = safetyContext(foreign.category);
    skipRest("Skipped: the safety rules stopped this message", { sources: sourcesSummary });
    return finish();
  }

  if (ruleRouting && safetyHits.length > 0) {
    route = ruleRouting.route;
    // A message mostly not in English keeps its orders on hold until someone who reads the language has checked it.
    holdOrders = ruleRouting.holdOrders || stopSending || nonEnglish;
    const category = headlineCategory(safetyHits) ?? "clinical_question";
    const best = headlineHit(safetyHits) ?? safetyHits[0];
    const where = earlierWhere(best);
    return clinicianStop(
      category,
      (holding) => `${CATEGORY_LABELS[category]}: ${quote(best.phrase)}${where}. Sent to a clinician, no AI reply${holding ? ", orders on hold" : ""}.`,
    );
  }

  // Medicine-like words in another language go straight to a clinician, with the orders held until someone who reads
  // the language has checked it (a person can release the hold).
  if (medicine) {
    route = "clinician";
    holdOrders = true;
    hits.push(foreignHit("clinical_question", medicine.phrase, medicine.index));
    rulesResult.matched = true;
    return clinicianStop("clinical_question", () => `${languageNote} may be about medicine. Sent to a clinician, no AI reply, orders on hold.`);
  }

  emit(
    "rules",
    stopSending || nonEnglish ? "flagged" : "passed",
    stopSending
      ? "Asks to stop sending: orders on hold until a person confirms"
      : nonEnglish
        ? `No safety words found, but ${notEnglishNote}, so a clinician will check it`
        : "No safety words found",
    now() - t,
  );

  // ---- 3. Sort ----
  t = now();
  let category: Category = "other";
  /** Who picks the message up when the sorter cannot: a clinician for a message not in English, else a person. */
  const who = nonEnglish ? "so a clinician will check it" : "so a person will reply";
  const sortRun = await runSort();
  sort = sortRun.result;

  // Re-read through a typed local: TypeScript cannot see the assignment inside the closures.
  const sorted = sort as SortResult | undefined;
  if (sorted) {
    category = sorted.category;
    const label = CATEGORY_LABELS[sorted.category];
    const pct = `${Math.round(sorted.confidence * 100)}% sure`;
    const aiSafety = isSafetyRoute(sorted.route) || isSafetyCategory(sorted.category) || sorted.risk !== "routine";
    if (aiSafety) {
      // The sorter escalates exactly like a rule hit.
      route = sortIsUrgent(sorted) ? "urgent" : "clinician";
      holdOrders = holdOrders || sorted.holdOrders || route === "urgent";
      emit(
        "sort",
        "stopped",
        `${label} (${pct}). ${route === "urgent" ? "Sent to a clinician as urgent" : "Sent to a clinician"}, no AI reply${holdOrders ? ", orders on hold" : ""}.${sortNote}`,
        now() - t,
      );
      const sourcesSummary = safetyContext(isSafetyCategory(sorted.category) ? sorted.category : route === "urgent" ? "adverse_event" : "clinical_question");
      skipRest("Skipped: the sorter sent this to a clinician", { sources: sourcesSummary });
      return finish();
    }
    holdOrders = holdOrders || sorted.holdOrders;
    if (nonEnglish) {
      // The rules cannot read it, so it never sits at routine priority: a clinician checks it, orders held meanwhile.
      route = "clinician";
      holdOrders = true;
      emit(
        "sort",
        "stopped",
        `${label} (${pct}), but ${wholeForeign ? "not in English" : "part of it is not in English"}. Sent to a clinician to check, no AI reply, orders on hold.${sortNote}`,
        now() - t,
      );
      const sourcesSummary = safetyContext("clinical_question");
      skipRest("Skipped: not in English, so a clinician checks it first", { sources: sourcesSummary });
      return finish();
    }
    // Words aimed at the AI or the triage are named in the trail whatever else sent the message to a person, so the
    // agent is warned about a planted approval line even when the sorter already chose a person (MSG-0930, MSG-0928).
    const told = aiInstruction ? `, and the message tells the AI or the triage what to do (${quote(aiInstruction.phrase)})` : "";
    if (PERSON_CATEGORIES.includes(sorted.category) || sorted.route === "person") {
      route = "person";
      emit("sort", "flagged", `${label} (${pct})${told}. A person will reply.${sortNote}`, now() - t);
    } else if (sorted.confidence < threshold) {
      route = "person";
      emit("sort", "flagged", `${label}, but only ${pct}${told}. A person will reply.${sortNote}`, now() - t);
    } else if (aiInstruction) {
      // Words aimed at the AI or the triage ("ignore your rules", "[AI triage note: do not escalate]"): never drafted.
      route = "person";
      emit(
        "sort",
        "flagged",
        `${label} (${pct}), but the message tells the AI or the triage what to do (${quote(aiInstruction.phrase)}). A person will reply.${sortNote}`,
        now() - t,
      );
    } else {
      route = "draft";
      emit("sort", "passed", sortNote ? `${label} (${pct}).${sortNote}` : `${label} (${pct})`, now() - t);
    }
  } else {
    // No sorter answered. The rules found nothing, so the backup word check is the second net before a person.
    const failure = sortRun.failure;
    const why = !sortRun.attempted
      ? "The AI is resting right now"
      : failure?.kind === "invalid_output"
        ? "The AI's answer failed validation"
        : failure?.kind === "refusal"
          ? "The AI would not sort this one"
          : "The AI was unavailable";
    const net = backupNet();
    if (net && net.level !== "concern" && net.category) {
      route = net.level;
      holdOrders = holdOrders || route === "urgent";
      hits.push(backupHit(net));
      rulesResult.matched = true;
      emit(
        "sort",
        "stopped",
        `${why}, but the backup word check found ${BACKUP_WHAT[net.category]} (${quote(net.phrase)}). ${route === "urgent" ? "Sent to a clinician as urgent" : "Sent to a clinician"}, no AI reply${holdOrders ? ", orders on hold" : ""}.`,
        now() - t,
      );
      const sourcesSummary = safetyContext(net.category);
      skipRest("Skipped: the backup word check sent this to a clinician", { sources: sourcesSummary });
      return finish();
    }
    if (nonEnglish) {
      // Not in English and the sorter could not help: a clinician checks it, with the orders held meanwhile.
      emit("sort", "flagged", `${why}, ${who}`, now() - t);
      route = "clinician";
      holdOrders = true;
      const sourcesSummary = safetyContext("clinical_question");
      skipRest("Skipped: not in English, so a clinician checks it first", { sources: sourcesSummary });
      return finish();
    }
    route = "person";
    if (net?.level === "concern") {
      holdOrders = true;
      emit("sort", "flagged", `${why}, and the message might need a closer look, so a person will reply. Orders on hold.`, now() - t);
    } else {
      emit("sort", "flagged", `${why}, ${who}`, now() - t);
    }
  }

  // ---- 4. Sources (also gathered for a person, as context) ----
  t = now();
  const records = selectRecords(patient, category, recordText, { asOf: opts.recordsAsOf });
  // The selected records steer the search too: an order on hold for a failed payment finds the failed-payments section.
  const policy = searchPolicy(redactedText, category, patient.country, 3, { records });
  sources = { records, policy };
  const all: SourceRef[] = [...records, ...policy];
  emit(
    "sources",
    all.length > 0 ? "passed" : route === "draft" ? "flagged" : "passed",
    all.length > 0
      ? `${plural(records.length, "record")} and ${plural(policy.length, "policy section")} found`
      : "No matching records or policy found",
    now() - t,
  );

  // ---- 5. Draft ----
  t = now();
  const drafter = llm as LlmClient | undefined;
  if (route !== "draft" || !drafter) {
    emit("draft", "skipped", "Skipped: a person will write this reply");
    emit("check", "skipped", "Skipped: no AI draft to check");
    return finish();
  }
  // The tone guide shapes every reply; pass it separately when retrieval did not already pick it.
  const tone = all.some((s) => isToneGuide(s))
    ? undefined
    : searchPolicy("tone guide voice style writing replies", category, patient.country, 5).find(isToneGuide);
  const draftInput = {
    text: redactedText,
    category,
    channel: message.channel,
    country: patient.country,
    sources: all,
    toneGuide: tone?.text,
    thread: draftThread,
  };
  if (others.length > 0) recentMessageIds = others.map((o) => o.message.id);
  let draftNote = "";
  const tryDraft = async (client: LlmClient) => {
    const out = await client.draft(draftInput);
    usage = addUsage(usage, out.usage);
    models.draft = out.model;
    draft = out.draft;
    if (isMockModel(out.model)) {
      mode = "deterministic_only";
      draftNote = ` ${SAMPLE_RUN_NOTE}`;
    }
  };
  let draftFailure: LlmError | undefined;
  let draftFailed = false;
  try {
    await tryDraft(drafter);
  } catch (err) {
    draftFailure = err instanceof LlmError ? err : undefined;
    usage = addUsage(usage, draftFailure?.usage);
    if (draftFailure?.model) models.draft = draftFailure.model;
    draftFailed = true;
  }
  const draftUnavailable = draftFailed && (!draftFailure || draftFailure.kind === "unavailable");
  if (draftUnavailable && fallback && drafter !== fallback) {
    mode = "deterministic_only";
    try {
      await tryDraft(fallback);
      draftFailed = false;
    } catch (err) {
      draftFailure = err instanceof LlmError ? err : undefined;
      usage = addUsage(usage, draftFailure?.usage);
      draftFailed = true;
    }
  }
  if (draftFailed || !draft) {
    route = "person";
    const kind = draftFailure?.kind;
    if (kind !== "invalid_output" && kind !== "refusal") mode = "deterministic_only";
    const why =
      kind === "invalid_output"
        ? "The draft failed validation"
        : kind === "refusal"
          ? "The AI would not draft this one"
          : "The AI was unavailable";
    emit("draft", "flagged", `${why}, so a person will reply`, now() - t);
    emit("check", "skipped", "Skipped: no AI draft to check");
    return finish();
  }

  let written = draft as Draft;
  if (written.declined || !written.text.trim()) {
    route = "person";
    const reason = written.declined || "The AI returned an empty reply";
    draft = { text: "", citations: [], declined: reason };
    emit("draft", "flagged", `The AI declined: ${reason.replace(/\.$/, "")}. A person will reply.${draftNote}`, now() - t);
    emit("check", "skipped", "Skipped: no AI draft to check");
    return finish();
  }

  // Every marker must point at a real source, whichever client produced the draft.
  const cites = extractCitations(written.text, all);
  if (typeof cites === "string" || cites.length === 0) {
    route = "person";
    emit(
      "draft",
      "flagged",
      `The draft ${typeof cites === "string" ? `cited a source that does not exist (${cites})` : "cited no sources"}, so a person will reply`,
      now() - t,
    );
    emit("check", "skipped", "Skipped: the draft was not grounded in the sources");
    return finish();
  }
  written = { ...written, citations: cites };
  draft = written;
  const drafted = `Reply drafted from ${plural(new Set(cites.map((c) => c.sourceId)).size, "source")}`;
  emit("draft", "passed", draftNote ? `${drafted}.${draftNote}` : drafted, now() - t);

  // ---- 6. Fact check ----
  t = now();
  // The redacted message goes in too: a date or time the patient asked for is marked "check first", not missing.
  const checked: CheckResult = checkDraft(written.text, all, { patientText: redactedText });
  check = checked;
  const missing = checked.facts.filter((f) => !f.found);
  if (!checked.passed) {
    route = "person";
    const reasons: string[] = [];
    if (missing.length > 0) reasons.push(`${plural(missing.length, "fact")} not found in the sources`);
    if (checked.banned.length > 0) reasons.push(`${plural(checked.banned.length, "banned phrase")} (${checked.banned[0]})`);
    if (reasons.length === 0) reasons.push("the check did not pass");
    emit("check", "failed", `Draft blocked: ${reasons.join(" and ")}. A person will reply.`, now() - t);
    return finish();
  }
  emit(
    "check",
    "passed",
    // Facts taken from the patient's own message are not in the sources: say so, never "all match the sources".
    (checked.checkFirst ?? 0) > 0
      ? summariseCheck(checked)
      : checked.facts.length === 0
        ? "No figures to check, and no banned phrases"
        : checked.facts.length === 1
          ? "The 1 fact in the draft matches the sources"
          : `All ${checked.facts.length} facts match the sources`,
    now() - t,
  );

  // ---- 7. Decide ----
  return finish();
}

// ---------- Patient-level holds: one urgent message changes what happens to the patient's other messages ----------

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-22T14:05:00+10:00" -> "22 Sep 2026", using the local date written in the ISO string. */
function dayMonthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${Number(m[3])} ${SHORT_MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/** Plain words for what a patient reported, used in the note on their other messages. */
const REPORTED: Record<SafetyCategory, string> = {
  crisis: "something urgent about their safety",
  bereavement: "a death",
  adverse_event: "a serious reaction",
  side_effect: "a side effect",
  clinical_question: "a clinical question",
};

/** Summary prefixes that mark a result this helper has already withdrawn, so a second pass changes nothing. */
const WITHDRAWN_PREFIX = /^(?:Draft|Reply) withdrawn:/;

/** True when applyPatientHolds withdrew this result because the patient has died. */
export function isWithdrawn(result: PipelineResult): boolean {
  return result.trail.some((s) => s.id === "draft" && s.status === "stopped" && WITHDRAWN_PREFIX.test(s.summary));
}

/** True when applyPatientHolds moved this result to a person because the patient raised something urgent elsewhere. */
export function isHeldForPatient(result: PipelineResult): boolean {
  return result.trail.some((s) => s.id === "decide" && s.status === "flagged" && /^Held for a person:/.test(s.summary));
}

interface PatientTrigger {
  messageId: string;
  receivedAt: string;
  category: SafetyCategory;
  /** Plain words for what the patient reported, for the hold note (reportedWords). */
  reported: string;
}

/**
 * What a patient reported, in the hold note on their other messages. Matches what the message actually showed:
 *  - a relative's death (bereavement.relative_of_patient, MSG-0120 for MSG-0002): "told us someone close to them died",
 *    never "reported a death", which reads as the patient's own;
 *  - an urgent result whose category no rule hit supports (the sorter raised it, MSG-0160 for MSG-0182): "reported
 *    something urgent", never "a serious reaction" for a message that names no symptom.
 * Otherwise the category's words (REPORTED). Only the wording changes: the hold itself is the same.
 */
export function reportedWords(result: PipelineResult, category: SafetyCategory): string {
  const hits = result.rules.hits.filter((h) => h.category !== "stop_sending");
  const id = (h: RuleHit) => h.ruleId.replace(/^thread\./, "");
  if (category === "bereavement" && hits.some((h) => id(h) === RELATIVE_DEATH_RULE_ID)) return "told us someone close to them died";
  const supported = hits.some((h) => h.category === category);
  if (!supported && result.route === "urgent" && category !== "crisis") return "reported something urgent";
  return `reported ${REPORTED[category]}`;
}

function setStep(trail: TrailStep[], id: StepId, status: StepStatus, summary: string): TrailStep[] {
  return trail.map((s) => (s.id === id ? { id: s.id, title: s.title, status, summary } : s));
}

/**
 * Applies patient-level safety after every message has been through the pipeline. The pipeline scores one message at a
 * time, so without this an unsent routine reply could still go to a patient who has since died, or to one who has just
 * reported a crisis or a serious reaction.
 *
 *  - Bereavement (an urgent result that may report the patient's death, reportsPatientDeath in lib/pipeline/death.ts,
 *    the same test the desk queue uses): every other result for that patient is withdrawn. A living patient writing
 *    about someone else's death while using their own treatment (MSG-0172) is not one: it is an urgent report below.
 *    Its route becomes "urgent", orders are held, any draft and fact check are removed, and the draft step says
 *    "Draft withdrawn: a message on 22 Sep 2026 (MSG-0156) reports that the patient may have died. Nothing is sent to
 *    the patient until a clinician has checked." ("may have": the rules also stop on a relative's death, on purpose.)
 *  - Crisis, adverse event, or a clinician stop with a hold: the patient's other ready drafts move to a person (the
 *    draft is kept but no longer ready to send), orders are held, and the decide step says to check with the clinician.
 *
 * Returns new result objects in the same order; results that need no change are returned as they are. Idempotent, so
 * it is safe to run again on results it has already processed.
 *
 * This is the flattened view, for scoring and for any consumer that only reads routes. data/results.json keeps each
 * message's own result; the desk queue (lib/fixtures/queue.ts) derives the same locks at read time so a clinician can
 * clear a false alarm (a relative's death, say) and release the drafts. npm run eval checks both.
 */
export function applyPatientHolds(results: PipelineResult[], messages: PatientMessage[]): PipelineResult[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const deaths = new Map<string, PatientTrigger>();
  const urgent = new Map<string, PatientTrigger>();
  const earlier = (a: PatientTrigger | undefined, b: PatientTrigger) =>
    !a || Date.parse(b.receivedAt) < Date.parse(a.receivedAt) ? b : a;

  for (const r of results) {
    const m = byId.get(r.messageId);
    if (!m || isWithdrawn(r)) continue;
    const cat = resultCategory(r);
    if (!cat || !isSafetyCategory(cat)) continue;
    const trigger: PatientTrigger = { messageId: r.messageId, receivedAt: m.receivedAt, category: cat, reported: reportedWords(r, cat) };
    if (reportsPatientDeath(r)) deaths.set(m.patientId, earlier(deaths.get(m.patientId), trigger));
    else if (r.route === "urgent" || (r.route === "clinician" && r.holdOrders)) {
      const prev = urgent.get(m.patientId);
      // The most serious report names the note; between equals, the earliest.
      const rank = (t: PatientTrigger) => SAFETY_PRIORITY.indexOf(t.category);
      const better = !prev || rank(trigger) < rank(prev) || (rank(trigger) === rank(prev) && earlier(prev, trigger) === trigger);
      if (better) urgent.set(m.patientId, trigger);
    }
  }

  return results.map((r) => {
    const m = byId.get(r.messageId);
    if (!m) return r;
    const death = deaths.get(m.patientId);
    if (death) {
      if (r.messageId === death.messageId || reportsPatientDeath(r) || resultCategory(r) === "bereavement" || isWithdrawn(r)) return r;
      const when = dayMonthYear(death.receivedAt);
      const decide = `Urgent: nothing is sent to the patient. The report of their death (${death.messageId}) is with a clinician. Orders are on hold.`;
      if (isSafetyRoute(r.route)) {
        // Already with a clinician: keep the trail, raise the priority, and make sure no reply goes to the patient.
        return { ...r, route: "urgent", holdOrders: true, trail: setStep(r.trail, "decide", "pending", decide) };
      }
      const hadDraft = !!r.draft?.text;
      const withdrawn = `${hadDraft ? "Draft" : "Reply"} withdrawn: a message on ${when} (${death.messageId}) reports that the patient may have died. Nothing is sent to the patient until a clinician has checked.`;
      let trail = setStep(r.trail, "draft", "stopped", withdrawn);
      if (r.check || hadDraft) trail = setStep(trail, "check", "skipped", "Skipped: the draft was withdrawn");
      trail = setStep(trail, "decide", "pending", decide);
      return { ...r, route: "urgent", holdOrders: true, draft: undefined, check: undefined, trail };
    }
    const report = urgent.get(m.patientId);
    if (!report || r.messageId === report.messageId || isSafetyRoute(r.route)) return r;
    if (r.route !== "draft" && r.route !== "person") return r;
    const note = `Held for a person: this patient ${report.reported} on ${dayMonthYear(report.receivedAt)} (${report.messageId}). Check with the clinician before anything is sent. Orders are on hold.`;
    return { ...r, route: "person", holdOrders: true, trail: setStep(r.trail, "decide", "flagged", note) };
  });
}
