/**
 * The team lead's numbers, worked out from the public data files. Pure functions, no React.
 *
 * Every figure here is either counted from the fictional demo queue (public/data/queue.json), taken from the test set
 * (public/data/eval-report.json), or estimated from the simulated baseline (public/data/baseline.json) and the
 * assumptions the viewer can change. Nothing is a real-world result.
 */
import type { Baseline, Category, RoutineCategory, SafetyCategory } from "@/lib/types";
import { ROUTINE_CATEGORIES, SAFETY_CATEGORIES } from "@/lib/types";
import type { PublicEvalReport, QueueRow } from "@/lib/client/types";

/** Matches DEFAULT_CONFIDENCE_THRESHOLD in lib/pipeline/run.ts (not imported, so the page does not bundle the pipeline). */
export const CONFIDENCE_THRESHOLD = 0.75;

/** Routine types that go to a person on purpose, whatever the sorter's confidence. */
export const PERSON_BY_DESIGN: readonly RoutineCategory[] = ["wants_human", "complaint", "privacy_request"];

// ---------- Assumptions ----------

export interface Assumptions {
  minutesPerManualReply: number;
  minutesPerReview: number;
  weeklyMessages: number;
  hourlyCostAud: number;
  /** How long the on-call clinician takes to open a flagged message. A simulation input, not a measurement. */
  clinicianPickupMin: number;
}

export type AssumptionKey = keyof Assumptions;

export interface AssumptionSpec {
  key: AssumptionKey;
  label: string;
  unit: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

export const ASSUMPTION_SPECS: AssumptionSpec[] = [
  {
    key: "minutesPerManualReply",
    label: "Minutes to write a reply by hand",
    unit: "min",
    hint: "Reading the message, looking up the order and writing the reply.",
    min: 1,
    max: 60,
    step: 0.5,
  },
  {
    key: "minutesPerReview",
    label: "Minutes to review a draft",
    unit: "min",
    hint: "Reading a checked draft and its sources, then sending it.",
    min: 0.5,
    max: 60,
    step: 0.5,
  },
  {
    key: "weeklyMessages",
    label: "Patient messages a week",
    unit: "messages",
    hint: "All incoming patient messages, every country.",
    min: 1,
    max: 100000,
    step: 50,
  },
  {
    key: "hourlyCostAud",
    label: "Agent cost per hour",
    unit: "AUD",
    hint: "The loaded cost of an agent's hour, in Australian dollars.",
    min: 1,
    max: 500,
    step: 1,
  },
  {
    key: "clinicianPickupMin",
    label: "Minutes for a clinician to pick up",
    unit: "min",
    hint: "From a safety message arriving to the on-call clinician opening it.",
    min: 1,
    max: 1440,
    step: 1,
  },
];

/** A simulated input with no source in the data files: stated as an assumption the viewer can change. */
export const DEFAULT_CLINICIAN_PICKUP_MIN = 15;

export function defaultAssumptions(baseline: Baseline): Assumptions {
  return { ...baseline.assumptions, clinicianPickupMin: DEFAULT_CLINICIAN_PICKUP_MIN };
}

export function sameAssumptions(a: Assumptions, b: Assumptions): boolean {
  return ASSUMPTION_SPECS.every((s) => a[s.key] === b[s.key]);
}

/** Parses what was typed. Returns undefined when it is not a number in range. */
export function parseAssumption(spec: AssumptionSpec, raw: string): number | undefined {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < spec.min || n > spec.max) return undefined;
  return n;
}

// ---------- The demo queue ----------

export type RouteKey = "draft" | "person" | "clinician" | "urgent";
export const ROUTE_ORDER: RouteKey[] = ["draft", "person", "clinician", "urgent"];

export interface CategoryCount {
  category: Category;
  safety: boolean;
  count: number;
  /** Messages of this type that got a checked draft (route draft). */
  drafted: number;
}

export interface AutomateCandidate {
  category: RoutineCategory;
  total: number;
  /** Replies still written by hand (route person). */
  byHand: number;
  /** Of those, the sorter was below the confidence bar. */
  unsure: number;
  /** Of those, a draft was written but declined or blocked by the fact check. */
  blocked: number;
  /** Of those, the sorter was sure and chose a person, so no draft was tried. */
  chosePerson: number;
}

export interface WeekStats {
  total: number;
  categories: CategoryCount[];
  routes: Record<RouteKey, number>;
  /** Drafts the desk may send as they are (no patient-level lock). */
  ready: number;
  /** Drafts held back by another message from the same patient. */
  lockedDrafts: { checkFirst: number; withdrawn: number };
  /** Every reply (draft or person) withdrawn after a reported death. */
  withdrawnAll: number;
  safety: number;
  holdMessages: number;
  holdPatients: number;
  /** Safety messages the rules stopped before any AI could reply (urgent and clinical). */
  ruleStops: number;
  /**
   * Rule stops where no model ran at all: the sort step was skipped (urgent stops). Clinical rule stops are still
   * double-checked by the sorter for anything more urgent, so they are not counted here.
   */
  noAiStops: number;
  patients: number;
  automate: AutomateCandidate[];
  byDesign: { category: RoutineCategory; count: number }[];
}

const SAFETY_SET = new Set<string>(SAFETY_CATEGORIES);

function isSafetyRow(r: QueueRow): boolean {
  return r.route === "clinician" || r.route === "urgent";
}

/**
 * True when no model ran on a rule stop. Uses reason.aiChecked (the sort step was not skipped) when the queue file
 * carries it; otherwise an urgent rule stop with no sorter confidence, which is when the sort step is skipped.
 */
function ranNoAi(r: QueueRow): boolean {
  if (r.reason.stoppedAt !== "rules") return false;
  const aiChecked = (r.reason as { aiChecked?: boolean }).aiChecked;
  if (typeof aiChecked === "boolean") return !aiChecked;
  return r.route === "urgent" && r.confidence == null;
}

export function weekStats(rows: readonly QueueRow[]): WeekStats {
  const routes: Record<RouteKey, number> = { draft: 0, person: 0, clinician: 0, urgent: 0 };
  const byCat = new Map<Category, CategoryCount>();
  const auto = new Map<RoutineCategory, AutomateCandidate>();
  const holdPatients = new Set<string>();
  const patients = new Set<string>();
  let ready = 0;
  let checkFirst = 0;
  let withdrawnDrafts = 0;
  let withdrawnAll = 0;
  let holdMessages = 0;
  let ruleStops = 0;
  let noAiStops = 0;

  for (const r of rows) {
    routes[r.route] += 1;
    patients.add(r.patientId);
    const safety = isSafetyRow(r);

    const category: Category = r.category ?? r.reason.category ?? "other";
    const cat = byCat.get(category) ?? { category, safety: SAFETY_SET.has(category), count: 0, drafted: 0 };
    cat.count += 1;
    if (r.route === "draft") cat.drafted += 1;
    byCat.set(category, cat);

    if (r.route === "draft") {
      if (r.status === "ready") ready += 1;
      else if (r.status === "check_first") checkFirst += 1;
      else if (r.status === "withdrawn") withdrawnDrafts += 1;
    }
    if (r.status === "withdrawn") withdrawnAll += 1;
    if (r.holdOrders) {
      holdMessages += 1;
      holdPatients.add(r.patientId);
    }
    if (safety && r.reason.stoppedAt === "rules") {
      ruleStops += 1;
      if (ranNoAi(r)) noAiStops += 1;
    }

    if (!safety && !SAFETY_SET.has(category)) {
      const rc = category as RoutineCategory;
      const a = auto.get(rc) ?? { category: rc, total: 0, byHand: 0, unsure: 0, blocked: 0, chosePerson: 0 };
      a.total += 1;
      if (r.route === "person") {
        a.byHand += 1;
        if (r.seed?.blockedDraft) a.blocked += 1;
        else if (r.confidence != null && r.confidence < CONFIDENCE_THRESHOLD) a.unsure += 1;
        else a.chosePerson += 1;
      }
      auto.set(rc, a);
    }
  }

  const order = [...ROUTINE_CATEGORIES, ...SAFETY_CATEGORIES] as Category[];
  const categories = [...byCat.values()].sort(
    (a, b) => Number(a.safety) - Number(b.safety) || b.count - a.count || order.indexOf(a.category) - order.indexOf(b.category),
  );

  const byDesignSet = new Set<string>(PERSON_BY_DESIGN);
  const candidates = [...auto.values()];
  const automate = candidates
    .filter((a) => !byDesignSet.has(a.category) && a.byHand > 0)
    .sort((a, b) => b.byHand - a.byHand || b.byHand / b.total - a.byHand / a.total);
  const byDesign = PERSON_BY_DESIGN.map((c) => ({ category: c, count: auto.get(c)?.total ?? 0 })).filter((x) => x.count > 0);

  return {
    total: rows.length,
    categories,
    routes,
    ready,
    lockedDrafts: { checkFirst, withdrawn: withdrawnDrafts },
    withdrawnAll,
    safety: routes.clinician + routes.urgent,
    holdMessages,
    holdPatients: holdPatients.size,
    ruleStops,
    noAiStops,
    patients: patients.size,
    automate,
    byDesign,
  };
}

// ---------- The estimate ----------

export interface WeekEstimate {
  weekOf: string;
  messages: number;
  beforeMin: number;
  afterMin: number;
}

export interface Estimate {
  /** Share of messages with a ready draft (sent after a review). */
  readyShare: number;
  /** Share that goes straight to a clinician. */
  safetyShare: number;
  /** Share still written by hand (no draft, or a draft held back). */
  manualShare: number;
  agentMinBefore: number;
  agentMinAfter: number;
  /** agentMinAfter / agentMinBefore. */
  ratio: number;
  weeks: WeekEstimate[];
  beforeMedianMin: number;
  afterMedianMin: number;
  hoursSaved: number;
  costSavedAud: number;
  /** Review takes at least as long as writing: nothing is saved. */
  noSaving: boolean;
  safetyBeforeMin: number;
  safetyAfterMin: number;
}

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The simple model, stated beside the chart:
 *  - Before, an agent writes every reply by hand: minutesPerManualReply per message.
 *  - After, a message with a ready draft takes minutesPerReview; one still written by hand takes minutesPerManualReply;
 *    a safety message leaves the agents' queue and goes straight to a clinician.
 *  - The same team works the same hours, so the wait for a first reply shrinks in proportion to agent minutes per
 *    message (a conservative reading: real queues usually shrink faster than that).
 *  - Hours saved count only the drafts (manual minus review). Safety messages move to clinicians, so no saving is
 *    counted for them.
 */
export function estimate(week: WeekStats, baseline: Baseline, a: Assumptions): Estimate {
  const n = Math.max(1, week.total);
  const readyShare = week.ready / n;
  const safetyShare = week.safety / n;
  const manualShare = Math.max(0, 1 - readyShare - safetyShare);
  const agentMinBefore = a.minutesPerManualReply;
  const agentMinAfter = readyShare * a.minutesPerReview + manualShare * a.minutesPerManualReply;
  const ratio = agentMinBefore > 0 ? agentMinAfter / agentMinBefore : 1;
  const weeks = baseline.weeks.map((w) => ({
    weekOf: w.weekOf,
    messages: w.messages,
    beforeMin: w.medianFirstResponseMin,
    afterMin: w.medianFirstResponseMin * ratio,
  }));
  const beforeMedianMin = median(baseline.weeks.map((w) => w.medianFirstResponseMin));
  const savedPerDraft = a.minutesPerManualReply - a.minutesPerReview;
  const hoursSaved = Math.max(0, (a.weeklyMessages * readyShare * savedPerDraft) / 60);
  return {
    readyShare,
    safetyShare,
    manualShare,
    agentMinBefore,
    agentMinAfter,
    ratio,
    weeks,
    beforeMedianMin,
    afterMedianMin: beforeMedianMin * ratio,
    hoursSaved,
    costSavedAud: hoursSaved * a.hourlyCostAud,
    noSaving: savedPerDraft <= 0,
    safetyBeforeMin: beforeMedianMin,
    safetyAfterMin: a.clinicianPickupMin,
  };
}

// ---------- AI cost ----------

export interface CostStats {
  /** Average AI cost per message across the test set, in US dollars. 0 for the sample (mock) models. */
  perMessageUsd: number;
  per1000Usd: number;
  cases: number;
  measured: boolean;
}

export function costStats(report: PublicEvalReport, isMock: boolean): CostStats {
  const per = report.totals.avgCostUsd;
  return {
    perMessageUsd: per,
    per1000Usd: per * 1000,
    cases: report.totals.cases,
    measured: !isMock && per > 0,
  };
}

/** Friendly rounding for estimates: 48.7 -> 49, 4.25 -> 4.3, 1234 -> 1230. */
export function roundEstimate(n: number): number {
  if (n >= 100) return Math.round(n / 10) * 10;
  if (n >= 10) return Math.round(n);
  return Math.round(n * 10) / 10;
}

export type { SafetyCategory };
