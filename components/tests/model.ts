/**
 * Pure helpers for the Test results page: headline figures, per-case outcomes, filters and search.
 * Everything is computed from public/data/eval-report.json, never hard-coded, so the page stays true when the
 * evaluation is rerun. All cases are fictional demo material.
 */
import type { Category, EvalCase, Route, ThreadEntry } from "@/lib/types";
import type { EvalCaseMeta, PublicEvalReport } from "@/lib/client/types";
import { CATEGORY_LABEL, COUNTRY_LABEL, ROUTE_LABEL } from "@/lib/format";
import type { Tone } from "@/components/ui";

export const isSafetyRoute = (r: Route) => r === "clinician" || r === "urgent";

/**
 * The message that reported this patient's death, when the evaluation moved a routine question to urgent because of
 * it (the eval appends "Withdrawn: MSG-xxxx reports that the patient has died" to the label's note). Undefined otherwise.
 */
export function laterDeathReport(c: EvalCase): string | undefined {
  return /Withdrawn: (MSG-\d{4}) reports that the patient has died/.exec(c.expected.note ?? "")?.[1];
}

/**
 * A safety message in the headline's sense (report.totals.safetyCases): its own label expects a clinician. A routine
 * question that became urgent only because a later message reported a death is not one; it is counted separately.
 */
export function isOwnSafety(c: EvalCase): boolean {
  return isSafetyRoute(c.expected.expectedRoute) && !laterDeathReport(c);
}

/** How cautious a route is: a higher rank means more human care. */
const ROUTE_RANK: Record<Route, number> = { draft: 0, person: 1, clinician: 2, urgent: 3 };

/** True when the case went to more human care than its label expected (for example urgent instead of clinician). */
export function isStricter(c: EvalCase): boolean {
  return ROUTE_RANK[c.got.route] > ROUTE_RANK[c.expected.expectedRoute];
}

export function holdMatches(c: EvalCase): boolean {
  return c.expected.mustHold === c.got.holdOrders;
}

// ---------- Outcome per case ----------

export type OutcomeKind = "match" | "type_differs" | "safer" | "false_alarm" | "different" | "miss";

export interface Outcome {
  kind: OutcomeKind;
  /** Short chip label. */
  label: string;
  tone: Tone;
  /** One plain sentence on what the difference means. */
  meaning: string;
}

export function caseOutcome(c: EvalCase): Outcome {
  if (c.safetyMiss) {
    return {
      kind: "miss",
      label: "Safety miss",
      tone: "urgent",
      meaning: "A safety miss. The evaluation fails until it is fixed.",
    };
  }
  if (c.falseEscalation) {
    return {
      kind: "false_alarm",
      label: "Escalated anyway",
      tone: "clinician",
      meaning: "A false alarm, accepted by design: a clinician clears it in a minute, and a miss is never acceptable.",
    };
  }
  if (c.routeCorrect) {
    if (c.categoryCorrect && holdMatches(c)) {
      return { kind: "match", label: "As expected", tone: "success", meaning: "Handled exactly as the label expected." };
    }
    const bits: string[] = [];
    if (!c.categoryCorrect) bits.push("the type label differed");
    if (!holdMatches(c)) bits.push(c.got.holdOrders ? "orders were held when they did not need to be" : "the hold differed");
    return {
      kind: "type_differs",
      label: "Right queue",
      tone: "neutral",
      meaning: `It reached the right queue, but ${bits.join(" and ")}.`,
    };
  }
  if (isStricter(c)) {
    return {
      kind: "safer",
      label: "More cautious",
      tone: "info",
      meaning: "More cautious than it needed to be: more human care, never less.",
    };
  }
  return {
    kind: "different",
    label: "Less cautious",
    tone: "warning",
    meaning: "Less human care than the label expected. A person still reviews anything before it is sent.",
  };
}

/** The key under the case table: each result label in a few plain words, in the order they are worth reading. */
export const OUTCOME_KEY: { kind: OutcomeKind; label: string; tone: Tone; short: string }[] = [
  { kind: "match", label: "As expected", tone: "success", short: "handled exactly as labelled" },
  { kind: "type_differs", label: "Right queue", tone: "neutral", short: "right queue, a type or hold label differed" },
  { kind: "safer", label: "More cautious", tone: "info", short: "more human care than it needed" },
  { kind: "false_alarm", label: "Escalated anyway", tone: "clinician", short: "a routine message sent to a clinician, on purpose" },
  { kind: "different", label: "Less cautious", tone: "warning", short: "less human care than the label expected" },
  { kind: "miss", label: "Safety miss", tone: "urgent", short: "a safety message that missed its clinician" },
];

// ---------- Filters and search ----------

export type CaseFilter = "all" | "safety" | "death_later" | "tricky" | "redteam" | "queue" | "any";

export const FILTER_LABEL: Record<CaseFilter, string> = {
  all: "All",
  safety: "Safety",
  death_later: "Death reported later",
  tricky: "Tricky",
  redteam: "Surprise",
  queue: "Different queue",
  any: "Any difference",
};

/**
 * What a difference filter counts, said in the same nouns as the headline ("a different queue"), so the chip count
 * and the headline figure visibly reconcile.
 */
export const FILTER_HINT: Partial<Record<CaseFilter, string>> = {
  safety: "Messages whose own label is a safety type, the same set the headline counts.",
  death_later:
    "Routine questions from patients whose death was reported in a later message, so any open reply was withdrawn. They are counted apart from the safety messages.",
  queue: "Cases that went to a different queue from the one their label expected.",
  any: "Cases where the queue, the type or the hold differed from the label.",
};

// ---------- The conversation behind a case ----------

/** How a case view names an earlier reply written by the support team. */
export const TEAM_REPLY_LABEL = "Reply from the team";

/** The closed line over a case's earlier messages: how many, and how many of them the team wrote. */
export function threadSummary(thread: readonly Pick<ThreadEntry, "from">[]): string {
  const n = thread.length;
  const team = thread.filter((t) => t.from === "agent").length;
  const base = `${n} earlier ${n === 1 ? "message" : "messages"} in this conversation`;
  if (team === 0) return base;
  if (n === 1) return "1 earlier reply from the team in this conversation";
  if (team === n) return `${base}, all replies from the team`;
  return `${base}, including ${team === 1 ? "1 reply" : `${team} replies`} from the team`;
}

/**
 * Whether a case shows its earlier messages open. A surprise (red team) message is often built around its thread, and a
 * reply from the team can carry the fact that matters (MSG-0995: the death is told only in the team's note), so either
 * one opens it. Other cases keep the thread folded under the message.
 */
export function threadOpensByDefault(thread: readonly Pick<ThreadEntry, "from">[], testOnly: boolean): boolean {
  return thread.length > 0 && (testOnly || thread.some((t) => t.from === "agent"));
}

export function isRedTeam(meta?: EvalCaseMeta): boolean {
  return meta?.testOnly ?? false;
}

export function matchesFilter(c: EvalCase, filter: CaseFilter, meta?: EvalCaseMeta): boolean {
  switch (filter) {
    case "all":
      return true;
    case "safety":
      return isOwnSafety(c);
    case "death_later":
      return !!laterDeathReport(c);
    case "tricky":
      return c.expected.tricky === true;
    case "redteam":
      return isRedTeam(meta);
    case "queue":
      return !c.routeCorrect;
    case "any":
      return caseOutcome(c).kind !== "match";
  }
}

function normalise(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

/** Search over the id, the patient's first name, country, subject, preview and the type and queue labels. */
export function matchesQuery(c: EvalCase, meta: EvalCaseMeta | undefined, query: string): boolean {
  const q = normalise(query.trim());
  if (!q) return true;
  const hay = [
    c.messageId,
    c.messageId.replace("MSG-", ""),
    meta?.firstName ?? "",
    meta ? COUNTRY_LABEL[meta.country] : "",
    meta?.country ?? "",
    meta?.subject ?? "",
    meta?.preview ?? "",
    CATEGORY_LABEL[c.expected.expectedCategory],
    c.got.category ? CATEGORY_LABEL[c.got.category] : "",
    ROUTE_LABEL[c.expected.expectedRoute],
    ROUTE_LABEL[c.got.route],
    caseOutcome(c).label,
    meta?.testOnly ? "red team" : "",
    c.expected.tricky ? "tricky" : "",
  ]
    .map(normalise)
    .join(" \n ");
  return q.split(/\s+/).every((word) => hay.includes(word));
}

// ---------- Headline ----------

export interface Headline {
  cases: number;
  deskCases: number;
  redTeamCases: number;
  safetyCases: number;
  safetyCaught: number;
  /** Safety cases that were caught but lost urgent priority, or other strict misses. */
  safetyMisses: number;
  holdsExpected: number;
  holdsPlaced: number;
  routineCases: number;
  falseEscalations: number;
  redTeamSafety: number;
  redTeamCaught: number;
  routeCorrect: number;
  categoryCorrect: number;
  routeDifferences: number;
  /** Route differences that went to more human care than expected. */
  routeDifferencesSafer: number;
  /** Route differences with less human care than expected (not safety misses, which are counted above). */
  lessCautious: EvalCase[];
  /** Routine questions withdrawn because a later message reported the patient's death. */
  deathLater: number;
  deathLaterReached: number;
  draftsWritten: number;
  draftsPassed: number;
  draftsBlocked: number;
  /** Extra release-gate fields in the report (absent in older reports). */
  draftsToDeceased?: number;
  readyForUrgent?: number;
  avgCostUsd: number;
}

type ExtraTotals = { draftsToDeceased?: number; readyDraftsForUrgentPatients?: number };

export function headline(report: PublicEvalReport): Headline {
  const t = report.totals as PublicEvalReport["totals"] & ExtraTotals;
  const cases = report.cases;
  const redTeam = cases.filter((c) => report.caseMeta[c.messageId]?.testOnly);
  const redSafety = redTeam.filter((c) => isSafetyRoute(c.expected.expectedRoute));
  const diffs = cases.filter((c) => !c.routeCorrect);
  const deathLater = cases.filter((c) => !!laterDeathReport(c));
  return {
    cases: t.cases,
    deskCases: cases.length - redTeam.length,
    redTeamCases: redTeam.length,
    safetyCases: t.safetyCases,
    safetyCaught: t.safetyCaught,
    safetyMisses: cases.filter((c) => c.safetyMiss).length,
    holdsExpected: t.holdsExpected,
    holdsPlaced: t.holdsPlaced,
    routineCases: t.routineCases,
    falseEscalations: t.falseEscalations,
    redTeamSafety: redSafety.length,
    redTeamCaught: redSafety.filter((c) => !c.safetyMiss).length,
    routeCorrect: cases.filter((c) => c.routeCorrect).length,
    categoryCorrect: cases.filter((c) => c.categoryCorrect).length,
    routeDifferences: diffs.length,
    routeDifferencesSafer: diffs.filter(isStricter).length,
    lessCautious: diffs.filter((c) => !isStricter(c) && !c.safetyMiss),
    deathLater: deathLater.length,
    deathLaterReached: deathLater.filter((c) => isSafetyRoute(c.got.route)).length,
    draftsWritten: t.draftsWritten,
    draftsPassed: t.draftsPassedCheck,
    draftsBlocked: t.draftsBlockedByCheck,
    draftsToDeceased: t.draftsToDeceased,
    readyForUrgent: t.readyDraftsForUrgentPatients,
    avgCostUsd: t.avgCostUsd,
  };
}

/** "1 of 1" reads oddly as "every one of the 1": small helpers for sentence building. */
export function everyOrCount(n: number, of: number, noun: string, nounPlural = noun + "s"): string {
  if (n === of && of > 1) return `Every one of the ${of} ${nounPlural}`;
  if (n === of && of === 1) return `The one ${noun}`;
  return `${n} of ${of} ${of === 1 ? noun : nounPlural}`;
}

export function percent(n: number, of: number): string {
  if (of === 0) return "0%";
  return `${Math.round((n / of) * 100)}%`;
}

/** Group rows of the by-type table: safety types first, in order of seriousness, then routine types. */
export const SAFETY_ORDER: Category[] = ["crisis", "bereavement", "adverse_event", "side_effect", "clinical_question"];
