/**
 * Pure helpers for the clinician queue: reason wording, policy targets, grouping and what the hold covers.
 * No React here. Every patient, message and order is fictional demo material.
 */
import type { Country, Order, OrderStatus, PipelineResult, RuleHit, SafetyCategory } from "@/lib/types";
import { SAFETY_CATEGORIES } from "@/lib/types";
import { DEMO_NOW_MS, plural } from "@/lib/format";
import { applySession, type DeskRow } from "@/lib/client/queue";
import type { QueueRow } from "@/lib/client/types";
import { emptyClinicianRecord, type SessionData } from "@/lib/client/session-state";
import {
  AGENT_DEATH_RULE_ID,
  LIVING_PATIENT_RULE_ID,
  isLivingPatientReport,
  relativeDeathQuote,
  reportsPatientDeath,
} from "@/lib/pipeline/death";

export type ClinicianGroup = "urgent" | "clinician" | "agent";

export const GROUP_LABEL: Record<ClinicianGroup, string> = {
  urgent: "Urgent",
  clinician: "Clinician review",
  agent: "Escalated by an agent",
};

export function groupFor(row: DeskRow): ClinicianGroup {
  if (row.status === "urgent") return "urgent";
  if (row.escalatedByAgent) return "agent";
  return "clinician";
}

export function isSafetyCategory(c: string | undefined): c is SafetyCategory {
  return !!c && (SAFETY_CATEGORIES as readonly string[]).includes(c);
}

/**
 * The safety category that explains the escalation, or null for an agent escalation or an unlabelled route. When words
 * that can report a death come with another safety signal (a living patient writing about a relative's death and
 * taking more than prescribed, say), the other signal leads: it is about the patient's own care.
 */
export function reasonCategory(row: DeskRow): SafetyCategory | null {
  if (row.escalatedByAgent) return null;
  const c = row.reason.category ?? row.category;
  if (c === "bereavement") {
    const other = row.seed?.safety.find((s) => s !== "bereavement");
    if (other) return other;
  }
  return isSafetyCategory(c) ? c : null;
}

// ---------- Death reports ----------

// The whose-death test lives in lib/pipeline/death.ts, so the rules, the desk queue and this screen read a message the
// same way (MSG-0120: Mele writing about her father's death is never framed as her own death anywhere).
export { relativeDeathQuote };

export interface DeathFraming {
  /** A rule matched words that can report a death. */
  mentioned: boolean;
  /** Frame it as the patient's possible death: the only safety signal, and nothing says it is someone else's. */
  led: boolean;
  /** The words that read as the patient writing about someone else's death, when they do. */
  aboutSomeoneElse: string | null;
  /**
   * Why it reads that way: "signed" when a relative's death is named and the message is signed with the patient's
   * name; "own_treatment" when the safety rules found the writer using their own treatment now (the words quoted are
   * about that treatment).
   */
  aboutSomeoneElseBy: "signed" | "own_treatment" | null;
  /**
   * The safety rules read the writer as the living patient (isLivingPatientReport in lib/pipeline/death): no reply to
   * them was withdrawn, and the bereavement steps do not apply.
   */
  livingPatient: boolean;
  /**
   * The rules read the writer as using their own treatment now (an adverse.living_patient hit, MSG-0172). A relative's
   * death signed with the patient's name alone (MSG-0120, MSG-0945) is a living patient too, but says nothing about
   * their treatment, so this stays false and no screen says they are using it.
   */
  usingOwnTreatment: boolean;
  /** The other safety categories, most serious first. */
  others: SafetyCategory[];
}

/**
 * How to frame a message that may report a death: as the patient's death, or as the patient's own care first. Pass the
 * case's rule hits so the framing agrees with the desk: when the rules read the writer as the living patient, it is
 * never framed as the patient's death, whatever the sign-off says.
 */
export function deathFraming(row: DeskRow, text: string, firstName: string, hits: readonly RuleHit[] = []): DeathFraming {
  const safety = row.escalatedByAgent ? [] : (row.seed?.safety ?? []);
  const mentioned = !row.escalatedByAgent && (safety.includes("bereavement") || (row.reason.category ?? row.category) === "bereavement");
  const others = safety.filter((s) => s !== "bereavement");
  const livingPatient = mentioned && isLivingPatientReport(hits);
  const usingOwnTreatment = livingPatient && hits.some((h) => h.ruleId.replace(/^thread\./, "") === LIVING_PATIENT_RULE_ID);
  const signed = mentioned ? relativeDeathQuote(text, firstName) : null;
  const ownTreatment = livingPatient && !signed ? livingPatientPhrase(hits) : null;
  const aboutSomeoneElse = signed ?? ownTreatment;
  const aboutSomeoneElseBy = signed ? "signed" : ownTreatment ? "own_treatment" : null;
  const led = mentioned && others.length === 0 && !aboutSomeoneElse && !livingPatient;
  return { mentioned, led, aboutSomeoneElse, aboutSomeoneElseBy, livingPatient, usingOwnTreatment, others };
}

/** The words the rules matched when they read the writer as the living patient, from this message first. */
function livingPatientPhrase(hits: readonly RuleHit[]): string | null {
  const living = hits.filter((h) => h.ruleId.replace(/^thread\./, "") === LIVING_PATIENT_RULE_ID && h.phrase.trim());
  const hit = living.find((h) => !isEarlier(h)) ?? living[0];
  return hit ? hit.phrase.trim() : null;
}

const PATIENT_SIGNAL: Record<Exclude<SafetyCategory, "bereavement">, (first: string) => string> = {
  crisis: () => "uses words that can signal a crisis",
  adverse_event: () => "may describe a serious reaction",
  side_effect: () => "describes something that could be a side effect",
  clinical_question: (first) => `raises a question about ${first}'s medicine or dose`,
};

/** The reason in plain words, with a possible death framed by the rest of the message. */
export function reasonHeadline(row: DeskRow, death: DeathFraming, firstName: string): string {
  if (!death.mentioned || death.led) return reasonExplainer(row);
  const first = firstName || "the patient";
  const urgent = row.status === "urgent";
  const next = urgent ? "orders went on hold and a clinician makes contact" : "a clinician replies before anyone else";
  const lead = death.others[0];
  if (lead && lead !== "bereavement") {
    const signal = PATIENT_SIGNAL[lead](first);
    return death.aboutSomeoneElse
      ? `The message ${signal}, and it also mentions a death. It reads as ${first} writing about someone close to them, so ${first}'s own care comes first: ${next}.`
      : `The message ${signal}, and it also mentions a death. Check who wrote it: if ${first} has died, the bereavement steps apply. Otherwise ${first}'s care comes first: ${next}.`;
  }
  // Only a death, and it reads as someone else's (signed with the patient's name, say): the rules did tell whose death
  // it is, so the headline says why a clinician still sees it, not that the rules could not tell.
  return `The message mentions a death, and it reads as ${first} writing about someone close to them. The rules stop every mention of a death on purpose, so ${next}.`;
}

// ---------- Figures of speech ----------

/** Rules that match on purpose even in a figure of speech ("dying to get my order", "this wait is killing me"). */
const FIGURE_OF_SPEECH_RULES = new Set(["crisis.idiom_dying", "crisis.idiom_kill_me"]);

export interface FigureOfSpeech {
  /** The matched words, as written. */
  phrases: string[];
  /** Other words in the message still need a clinician (a dose question, say). */
  more: boolean;
}

/**
 * A rules-only stop on words the rules flag on purpose even as a figure of speech, and nothing more serious alongside
 * them: the case a clinician can clear in one step. Null otherwise.
 */
export function figureOfSpeech(row: DeskRow, result: PipelineResult): FigureOfSpeech | null {
  if (row.escalatedByAgent || row.reason.stoppedAt !== "rules") return null;
  if (result.sort && (result.sort.category === "crisis" || result.sort.category === "adverse_event")) return null;
  const hits = result.rules.hits;
  const idioms = hits.filter((h) => FIGURE_OF_SPEECH_RULES.has(h.ruleId) && !isEarlier(h));
  if (!idioms.length) return null;
  const serious = hits.some(
    (h) =>
      !FIGURE_OF_SPEECH_RULES.has(h.ruleId) &&
      (h.category === "crisis" || h.category === "adverse_event" || h.category === "bereavement"),
  );
  if (serious) return null;
  const phrases = [...new Set(idioms.map((h) => h.phrase))];
  const more = hits.some((h) => !FIGURE_OF_SPEECH_RULES.has(h.ruleId));
  return { phrases, more };
}

// ---------- False alarms ----------

/**
 * death     the message may report the patient's death, and the clinician can find it was someone else's.
 * figure    the only urgent words are ones the rules flag even in a figure of speech ("dying to get my order").
 * ai_flag   the AI check flagged it with no trigger words; it over-escalates on purpose.
 */
export type FalseAlarmKind = "death" | "figure" | "ai_flag";

export interface FalseAlarmFit {
  kind: FalseAlarmKind;
  /** Other safety readings that stay after the clear and still need a clinician, most serious first. */
  others: SafetyCategory[];
}

const SERIOUS_FIRST: SafetyCategory[] = ["crisis", "adverse_event", "side_effect", "clinical_question"];

function otherReadings(result: PipelineResult, skip: (h: RuleHit) => boolean): SafetyCategory[] {
  const found = new Set<string>(result.rules.hits.filter((h) => !skip(h)).map((h) => h.category));
  if (result.sort?.category) found.add(result.sort.category);
  return SERIOUS_FIRST.filter((c) => found.has(c));
}

/**
 * When "Mark as a false alarm" makes sense for this item, and what stays after it, or null when it does not. It is
 * offered only where a stop can be a false alarm: a possible death that may be someone else's, a figure of speech, or
 * a cautious AI flag with no trigger words. It is not offered for crisis language, a possible serious reaction, a side
 * effect or a living patient's report of their own treatment: those need a reply or a call, and a call that reaches
 * the patient releases what the message holds back.
 */
export function falseAlarmFit(row: DeskRow, result: PipelineResult): FalseAlarmFit | null {
  if (row.escalatedByAgent) return null;
  if (!(row.status === "urgent" || (row.status === "clinician" && row.holdOrders))) return null;
  if (reportsPatientDeath(result)) {
    return { kind: "death", others: otherReadings(result, (h) => h.category === "bereavement") };
  }
  // A patient writing about someone else's death with nothing else to flag (MSG-0120): the stop is a false alarm a
  // clinician can clear. A living patient's report of their own treatment (MSG-0172) has another reading, so it is not.
  if (isLivingPatientReport(result.rules.hits)) {
    const others = otherReadings(result, (h) => h.category === "bereavement");
    if (!others.length) return { kind: "death", others };
  }
  if (figureOfSpeech(row, result)) {
    return { kind: "figure", others: otherReadings(result, (h) => FIGURE_OF_SPEECH_RULES.has(h.ruleId)) };
  }
  if (row.reason.stoppedAt === "sort" && !result.rules.hits.length) return { kind: "ai_flag", others: [] };
  return null;
}

/** A clinician can mark this alert a false alarm (see falseAlarmFit). */
export function canClearAlert(row: DeskRow, result: PipelineResult): boolean {
  return falseAlarmFit(row, result) !== null;
}

/** A safety reading that stays after a clear, mid-sentence. */
export const READING_TEXT: Record<SafetyCategory, string> = {
  crisis: "words that can signal a crisis",
  adverse_event: "a possible serious reaction",
  side_effect: "a possible side effect",
  clinical_question: "a question only a clinician can answer",
  bereavement: "a mention of a death",
};

/** What a false-alarm clear would do to the patient's other replies, worked out with the same code the desk uses. */
export interface ClearPreview {
  /** The patient's other replies this message holds back now. */
  locked: number;
  /** Of those, the ones with nothing holding them after the clear. */
  released: number;
  /** Still held after the clear because this message still needs a clinician in touch. */
  heldByThis: number;
  /** Still held after the clear by another of the patient's alerts. */
  heldByOther: number;
  /** Still withdrawn after the clear: another message may report the patient's death. */
  withdrawn: number;
  /** This message withdrew replies before the clear (it read as a possible death). */
  wasWithdrawal: boolean;
  /** After the clear the message still holds replies back: only the death reading goes. */
  keepsAlert: boolean;
}

const NO_CHANGE: ClearPreview = {
  locked: 0,
  released: 0,
  heldByThis: 0,
  heldByOther: 0,
  withdrawn: 0,
  wasWithdrawal: false,
  keepsAlert: false,
};

/**
 * Runs the clear on a copy of this session (applySession, the same derivation the desk shows) and compares the
 * patient's other replies before and after, so the wording says what will actually happen.
 */
export function previewClear(items: readonly QueueRow[], data: SessionData, messageId: string): ClearPreview {
  const before = applySession(items, data);
  const self = before.find((r) => r.messageId === messageId);
  if (!self) return NO_CHANGE;
  const rec = data.clinician[messageId] ?? emptyClinicianRecord();
  const at = new Date(DEMO_NOW_MS).toISOString();
  const next: SessionData = {
    ...data,
    clinician: { ...data.clinician, [messageId]: { ...rec, cleared: { at, by: "preview", note: "preview" } } },
  };
  const after = new Map(applySession(items, next).map((r) => [r.messageId, r]));
  const locked = before.filter(
    (r) => r.patientId === self.patientId && r.messageId !== messageId && r.lock?.messageId === messageId,
  );
  const out: ClearPreview = {
    ...NO_CHANGE,
    locked: locked.length,
    wasWithdrawal: locked.some((r) => r.lock?.kind === "withdrawn"),
  };
  for (const r of locked) {
    const lock = after.get(r.messageId)?.lock;
    if (!lock) out.released++;
    else if (lock.kind === "withdrawn") out.withdrawn++;
    else if (lock.messageId === messageId) out.heldByThis++;
    else out.heldByOther++;
  }
  out.keepsAlert = out.heldByThis > 0 || Boolean(after.get(messageId)?.clearKeepsAlert);
  return out;
}

const stay = (n: number) => (n === 1 ? "stays" : "stay");

/** What the clear does, in full sentences, for the guidance above the button. */
export function clearEffectText(p: ClearPreview, firstName: string): string {
  const first = firstName || "the patient";
  if (!p.locked) return `It holds back no replies to ${first} on the desk.`;
  const parts: string[] = [];
  if (p.keepsAlert && p.wasWithdrawal) parts.push("It lifts the bereavement withdrawal.");
  if (p.released)
    parts.push(
      p.released === p.locked
        ? `It releases the ${plural(p.released, "reply", "replies")} it holds back on the desk.`
        : `It releases ${plural(p.released, "reply", "replies")} on the desk.`,
    );
  if (p.heldByThis)
    parts.push(
      `${plural(p.heldByThis, "reply", "replies")} ${stay(p.heldByThis)} held until you have been in touch with ${first}.`,
    );
  if (p.heldByOther)
    parts.push(`${plural(p.heldByOther, "reply", "replies")} ${stay(p.heldByOther)} held by another alert for ${first}.`);
  if (p.withdrawn)
    parts.push(
      `${plural(p.withdrawn, "reply", "replies")} ${stay(p.withdrawn)} withdrawn, because another message may report ${first}'s death.`,
    );
  return parts.join(" ");
}

/** What the clear did, short, for the toast. Undefined when it changed nothing on the desk. */
export function clearToastDetail(p: ClearPreview): string | undefined {
  if (!p.locked) return undefined;
  const parts: string[] = [];
  if (p.released) parts.push(`${plural(p.released, "reply", "replies")} released on the desk.`);
  if (p.heldByThis)
    parts.push(
      `${plural(p.heldByThis, "reply", "replies")} now ${p.heldByThis === 1 ? "waits" : "wait"} until you have been in touch.`,
    );
  if (p.heldByOther) parts.push(`${plural(p.heldByOther, "reply", "replies")} ${stay(p.heldByOther)} held by another alert.`);
  if (p.withdrawn) parts.push(`${plural(p.withdrawn, "reply", "replies")} ${stay(p.withdrawn)} withdrawn.`);
  return parts.join(" ");
}

/** Has a clinician acted on it: replied, spoken to the patient or cleared it as a false alarm. A missed call is not. */
export function isHandled(row: DeskRow): boolean {
  return row.clinicianReplied || spokeToPatient(row) || row.cleared;
}

/** A logged call reached the patient (or the family). */
export function spokeToPatient(row: DeskRow): boolean {
  return row.clinicianRecord?.calls.some((c) => callReachedPatient(c.outcome)) ?? false;
}

/** When it reached the clinician queue: on arrival for a safety stop, at the agent's decision otherwise. */
export function escalatedAt(row: DeskRow): string {
  if (row.escalatedByAgent && row.decision?.kind === "escalated") return row.decision.at;
  return row.receivedAt;
}

/** "Now" for times recorded in this session (real clock), never earlier than the demo's fixed now. */
export function sessionNow(): number {
  return Math.max(Date.now(), DEMO_NOW_MS);
}

/** The "now" to measure a row's waiting time against. */
export function nowFor(row: DeskRow): number {
  return row.escalatedByAgent ? sessionNow() : DEMO_NOW_MS;
}

const URGENT_POLICY: Record<Country, string> = {
  AU: "P10.2",
  NZ: "P10.3",
  UK: "P10.4",
};

export interface PolicyTarget {
  /** The policy section in the demo handbook. */
  ref: string;
  /** What the policy asks for, in plain words. */
  target: string;
}

export function policyFor(row: DeskRow): PolicyTarget {
  const cat = reasonCategory(row);
  if (row.status === "urgent") {
    return {
      ref: URGENT_POLICY[row.country],
      target: "Contact the patient or family within 1 hour, 24 hours a day.",
    };
  }
  if (cat === "side_effect") return { ref: "P10.1", target: "Reply within 4 business hours." };
  if (cat === "clinical_question") return { ref: "P10.1", target: "Reply within 1 business day." };
  return { ref: "P10.1", target: "Reply within 1 business day." };
}

/** One plain sentence on why this message came to a clinician. */
export function reasonExplainer(row: DeskRow): string {
  const cat = reasonCategory(row);
  switch (cat) {
    case "clinical_question":
      return "The patient asks something only a clinician can answer, so no AI reply was drafted.";
    case "side_effect":
      return "The patient describes something that could be a side effect. A clinician looks at it before anyone replies.";
    case "adverse_event":
      return "The message may describe a serious reaction. Orders went on hold and the on-call clinician makes contact first.";
    case "crisis":
      return "The message uses words that can signal a crisis. Orders went on hold and a person makes contact first.";
    case "bereavement":
      return "The message may report the patient's death. Everything for this patient stopped, and unsent replies to them were withdrawn until you confirm.";
    default:
      if (row.escalatedByAgent) return "An agent on the desk chose to pass this message to a clinician.";
      if (row.status === "urgent")
        return "The safety check marked this message urgent. Orders went on hold and a clinician makes contact first.";
      return "The safety check sent this message to a clinician, so no AI reply was drafted.";
  }
}

/**
 * Did an AI read this message? After a clinician-level rule stop the sorter still reads the redacted text once, to
 * check for anything more urgent. It did not when the step was skipped or when the backup word check (not an AI) ran.
 */
export function aiCheckedAfterStop(result: PipelineResult | undefined): boolean {
  const step = result?.trail.find((s) => s.id === "sort");
  if (!step || step.status === "skipped") return false;
  return !/backup word check/i.test(step.summary);
}

/** Where the trail stopped, in plain words. Pass the case's result so the wording matches what the AI actually read. */
export function stoppedAtText(row: DeskRow, result?: PipelineResult): string | null {
  if (row.escalatedByAgent) return null;
  if (row.reason.stoppedAt === "rules") {
    return aiCheckedAfterStop(result)
      ? "Stopped by the safety rules. The AI wrote no reply; it only checked the message, with personal details removed, for anything more urgent."
      : "Stopped by the safety rules, before any AI saw the message.";
  }
  if (row.reason.stoppedAt === "sort") {
    const base =
      "The safety rules found no trigger words. The AI check flagged it, and a safety flag from either one stops the trail.";
    return row.status === "urgent"
      ? `${base} It over-escalates on purpose: if this is a false alarm, you can mark it as one below.`
      : `${base} It over-escalates on purpose, so a person always looks.`;
  }
  return null;
}

/**
 * The escalation to open when no ?m= is given: the first urgent one the safety rules stopped on words in the message
 * itself (a clear case), else the first in view. A cautious AI flag with no trigger words is a poor first example.
 */
export function defaultEscalation(rows: readonly DeskRow[]): DeskRow | undefined {
  return (
    rows.find(
      (r) =>
        r.status === "urgent" && !r.escalatedByAgent && r.reason.stoppedAt === "rules" && r.reason.phraseIn === "message",
    ) ?? rows[0]
  );
}

// ---------- Highlighting ----------

export interface Range {
  start: number;
  end: number;
}

/** A hit found in an earlier message of the thread: the pipeline gives those a start below zero. */
export function isEarlier(hit: RuleHit): boolean {
  return hit.start < 0 || hit.end < 0;
}

/** A hit read in an earlier reply from the team (condolence words, MSG-0995), not in anything the patient wrote. */
export function isTeamHit(hit: Pick<RuleHit, "ruleId">): boolean {
  return hit.ruleId === AGENT_DEATH_RULE_ID || hit.ruleId.startsWith("thread.agent.");
}

/** Where each hit sits in the text, merged and sorted. Hits from earlier messages are left out. */
export function hitRanges(text: string, hits: readonly RuleHit[]): Range[] {
  const found: Range[] = [];
  for (const h of hits) {
    if (isEarlier(h)) continue;
    if (text.slice(h.start, h.end) === h.phrase) {
      found.push({ start: h.start, end: h.end });
      continue;
    }
    const i = text.toLowerCase().indexOf(h.phrase.toLowerCase());
    if (i >= 0) found.push({ start: i, end: i + h.phrase.length });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Range[] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/** Distinct matched phrases with their category, in the order they were found. */
export function distinctHits(
  hits: readonly RuleHit[],
): { phrase: string; category: RuleHit["category"]; earlier: boolean; team: boolean; ruleId: string }[] {
  const seen = new Set<string>();
  const out: {
    phrase: string;
    category: RuleHit["category"];
    earlier: boolean;
    /** Found in an earlier reply from the team, not in the patient's words (AGENT_DEATH_RULE_ID). */
    team: boolean;
    /** The first rule that matched these words. */
    ruleId: string;
  }[] = [];
  for (const h of hits) {
    const team = isTeamHit(h);
    const key = `${h.phrase.toLowerCase()}|${isEarlier(h)}|${team}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ phrase: h.phrase, category: h.category, earlier: isEarlier(h), team, ruleId: h.ruleId });
  }
  return out;
}

// ---------- Orders ----------

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  script_pending: "Script pending",
  dispensing: "Dispensing",
  shipped: "Shipped",
  delivered: "Delivered",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

const HELD: OrderStatus[] = ["script_pending", "dispensing", "on_hold"];

/** Orders the hold stops: everything not yet shipped (policy P10.2 to P10.4, step 1). */
export function heldOrders(orders: readonly Order[]): Order[] {
  return orders.filter((o) => HELD.includes(o.status));
}

/** Orders already with the courier: a hold cannot stop them, only an intercept can. */
export function inTransitOrders(orders: readonly Order[]): Order[] {
  return orders.filter((o) => o.status === "shipped");
}

/** Everything not yet delivered, held or on its way, in the patient's order. */
export function undeliveredOrders(orders: readonly Order[]): Order[] {
  return orders.filter((o) => HELD.includes(o.status) || o.status === "shipped");
}

// ---------- Calls ----------

/** The outcome saved with a call. Only a call where the clinician spoke to the patient releases the desk's locks. */
export const CALL_SPOKE = "Spoke to the patient";
export const CALL_NO_ANSWER = "No answer or voicemail";

/** A call that reached the patient. Calls saved before outcomes existed count as reached, as they always did. */
export function callReachedPatient(outcome: string | undefined): boolean {
  return outcome !== CALL_NO_ANSWER;
}

export function itemsText(order: Order): string {
  return order.items.map((i) => (i.qty > 1 ? `${i.name} x ${i.qty}` : i.name)).join(", ");
}
