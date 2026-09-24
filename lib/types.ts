/**
 * Care Desk shared contract. Single source of truth for data files, the pipeline and the UI.
 * All data described here is fictional demo material.
 *
 * ID formats (all fictional):
 *   Patient      PT-1001 ... PT-1060
 *   Order        ORD-20001 ...
 *   Charge       CHG-30001 ...
 *   Appointment  APT-40001 ...
 *   Message      MSG-0001 ...
 *   Tracking     CD + 10 digits, e.g. CD4829103756 (fictional courier "Courierline")
 *   Policy       P1.1, P3.2 ... (section ids in data/policy.json)
 */

export type Country = "AU" | "NZ" | "UK";
export type Currency = "AUD" | "NZD" | "GBP";
export type Channel = "email" | "chat";

export const ROUTINE_CATEGORIES = [
  "order_status", // where is my order, has it shipped
  "delivery_problem", // late, lost, damaged, wrong address, missed delivery
  "script_renewal", // repeat / renewal of prescription, running out
  "billing", // a charge, receipt, failed payment, refund request
  "price_change", // why did my price change, concession pricing
  "plan_change", // pause, cancel, change plan, stop sending
  "appointment", // book, reschedule, missed consult
  "account_access", // login, password, email change
  "product_question", // non-clinical: availability, substitution, packaging, storage
  "privacy_request", // access / delete my data, marketing opt-out
  "complaint", // unhappy with service (non-clinical)
  "wants_human", // explicitly asks to talk to a person
  "other",
] as const;

export const SAFETY_CATEGORIES = [
  "clinical_question", // dosing, interactions, pregnancy, driving, mixing with alcohol or other medicines
  "side_effect", // mild or moderate side effects
  "adverse_event", // serious reaction, hospital, ambulance, psychosis, chest pain, seizure
  "crisis", // self-harm, suicide, immediate danger
  "bereavement", // the patient has died (reported by family or a carer)
] as const;

export type RoutineCategory = (typeof ROUTINE_CATEGORIES)[number];
export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];
export type Category = RoutineCategory | SafetyCategory;

/**
 * Where a message goes.
 *  draft     AI drafts a reply, an agent approves / edits / sends. Only for routine messages the rules AND the
 *            sorter agree on, with confidence >= threshold, whose draft passed the fact check.
 *  person    No AI draft. An agent writes the reply (wants_human, complaint, privacy_request, low confidence,
 *            the drafter declined, or the fact check failed).
 *  clinician Clinical question or side effect. Clinician queue, no AI reply.
 *  urgent    Adverse event, crisis or bereavement. Clinician queue at top priority, orders on hold, no AI reply.
 */
export type Route = "draft" | "person" | "clinician" | "urgent";
export type Risk = "routine" | "clinical" | "urgent";

// ---------- World data (data/patients.json) ----------

export interface Address {
  line1: string;
  suburb: string; // suburb / town
  region: string; // state (AU), region (NZ), county or city (UK)
  postcode: string;
  country: Country;
}

export type PlanStatus = "active" | "paused" | "cancelled";

export interface Plan {
  name: string; // e.g. "Monthly treatment plan"
  monthlyPrice: number; // in the patient's currency
  currency: Currency;
  status: PlanStatus;
  startedAt: string; // ISO date
  nextBillingDate?: string; // ISO date
  concession?: boolean;
}

export type OrderStatus = "script_pending" | "dispensing" | "shipped" | "delivered" | "on_hold" | "cancelled";

export interface OrderItem {
  name: string; // generic only: "Oil, 25 mL", "Capsules, 30", "Oral spray, 20 mL"
  qty: number;
}

export interface Order {
  id: string;
  patientId: string;
  placedAt: string; // ISO datetime with offset
  status: OrderStatus;
  items: OrderItem[];
  total: number;
  currency: Currency;
  carrier?: string; // "Courierline"
  tracking?: string;
  shippedAt?: string;
  eta?: string; // ISO date
  deliveredAt?: string;
  holdReason?: string;
}

export type ChargeKind = "plan" | "shipping" | "refund" | "adjustment" | "consult";
export type ChargeStatus = "paid" | "failed" | "refunded" | "pending";

export interface Charge {
  id: string;
  patientId: string;
  at: string; // ISO datetime
  amount: number; // negative for refunds
  currency: Currency;
  description: string;
  kind: ChargeKind;
  status: ChargeStatus;
}

export type AppointmentKind = "initial" | "follow_up" | "renewal";
export type AppointmentStatus = "booked" | "completed" | "missed" | "cancelled";

export interface Appointment {
  id: string;
  patientId: string;
  at: string; // ISO datetime with offset
  kind: AppointmentKind;
  status: AppointmentStatus;
  clinician: string; // fictional, e.g. "Dr Hana Whitlock"
}

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string; // local format for the country
  dob: string; // ISO date
  address: Address;
  country: Country;
  timezone: string; // IANA, e.g. "Australia/Melbourne"
  identifiers?: { medicare?: string; nhi?: string; nhs?: string };
  plan: Plan;
  orders: Order[];
  charges: Charge[];
  appointments: Appointment[];
  /** One of three patients offered in the "Try a message" box. */
  demoPersona?: boolean;
  /** Short private note for demo authors, never rendered. */
  authorNote?: string;
}

// ---------- Policy (data/policy.json) ----------

export interface PolicySection {
  id: string; // "P3.2"
  title: string; // "Delivery times"
  body: string; // plain text, a few short paragraphs, written for the demo
  tags: string[]; // retrieval hints: ["delivery", "shipping", "late"]
  countries?: Country[]; // omit = applies everywhere
  source?: string; // for helpline numbers: official URL used to verify them
}

// ---------- Messages (data/messages.json) and labels (data/testset.json) ----------

export interface ThreadEntry {
  from: "patient" | "agent";
  at: string; // ISO datetime with offset
  body: string;
}

export interface PatientMessage {
  id: string; // MSG-0001
  patientId: string;
  channel: Channel;
  receivedAt: string; // ISO datetime with the patient's local offset
  subject?: string; // email only
  body: string;
  /** Earlier messages in the same conversation, oldest first (optional). */
  thread?: ThreadEntry[];
}

export interface TestLabel {
  messageId: string;
  expectedCategory: Category;
  expectedRoute: Route;
  mustHold: boolean; // orders must be put on hold
  tricky?: boolean; // deliberately hard case
  note?: string; // why it is tricky / what a correct system does
}

// ---------- Pipeline output ----------

export type StepId = "redact" | "rules" | "sort" | "sources" | "draft" | "check" | "decide";
export type StepStatus = "passed" | "stopped" | "flagged" | "skipped" | "failed" | "pending";

export interface TrailStep {
  id: StepId;
  status: StepStatus;
  title: string; // plain words, e.g. "Personal details removed"
  summary: string; // one line, e.g. "3 details hidden before the AI saw anything"
  ms?: number;
}

export type RedactionType = "name" | "email" | "phone" | "address" | "dob" | "health_id" | "card" | "other";

export interface Redaction {
  type: RedactionType;
  placeholder: string; // "[NAME]", "[PHONE]"
  count: number;
}

export interface RuleHit {
  ruleId: string; // "crisis.self_harm"
  category: SafetyCategory | "stop_sending";
  phrase: string; // the matched words, from the ORIGINAL text
  start: number; // index into the original text
  end: number;
}

export interface SortResult {
  category: Category;
  risk: Risk;
  route: Route;
  confidence: number; // 0..1
  reasons: string[]; // short, plain
  holdOrders: boolean;
}

export type SourceKind = "order" | "charge" | "appointment" | "plan" | "policy";

export interface SourceRef {
  id: string; // "ORD-20481" or "P3.2" or "PLAN"
  kind: SourceKind;
  label: string; // "Order ORD-20481, shipped 18 Sep"
  text: string; // the exact facts given to the drafter
  score?: number; // retrieval score for policy sections
}

export interface Citation {
  marker: string; // "[1]"
  sourceId: string;
}

export interface Draft {
  text: string; // with [1] style markers
  citations: Citation[];
  declined?: string; // if the model declined, why (then text is "")
}

export type FactKind = "date" | "amount" | "order_id" | "tracking" | "duration" | "time" | "other";

export interface FactCheck {
  text: string; // the fact as written in the draft
  kind: FactKind;
  found: boolean;
  sourceId?: string;
  /**
   * The fact is not in the sources, but the patient wrote it in their own (redacted) message: a date, time, weekday
   * or time frame they asked for. `found` is true and `sourceId` is "PATIENT_MESSAGE"; the agent checks it first.
   * Money, refund and approval figures never take this path: they must be in the sources.
   */
  fromPatient?: boolean;
  /** An amount worked out from two amounts the draft cites, in plain words ("NZ$162 minus NZ$149"). */
  derivedFrom?: string;
}

export interface CheckResult {
  facts: FactCheck[];
  banned: string[]; // e.g. "dosing figure: 10 mg"
  passed: boolean;
  /** How many facts came only from the patient's own message (each marked `fromPatient`). Absent when none. */
  checkFirst?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface PipelineResult {
  messageId: string;
  redactedText: string;
  redactions: Redaction[];
  rules: { matched: boolean; hits: RuleHit[] };
  sort?: SortResult; // absent when the rules stopped the trail
  sources?: { records: SourceRef[]; policy: SourceRef[] };
  draft?: Draft;
  check?: CheckResult;
  route: Route;
  holdOrders: boolean;
  trail: TrailStep[]; // always 7 steps in StepId order; later steps "skipped" after a stop
  models: { sort?: string; draft?: string };
  usage: Usage;
  versions: { rules: string; prompts: string };
  mode: "live" | "deterministic_only"; // deterministic_only = AI unavailable fallback
  /**
   * The same patient's other recent messages (separate conversations) the drafter was given as context, oldest first.
   * Absent when there were none or no draft was asked for. Context only, never a source.
   */
  recentMessageIds?: string[];
}

export interface ResultsFile {
  generatedAt: string;
  versions: { rules: string; prompts: string };
  models: { sort: string; draft: string };
  results: PipelineResult[];
}

// ---------- Evaluation (data/eval-report.json) ----------

export interface EvalCase {
  messageId: string;
  expected: TestLabel;
  got: { category?: Category; route: Route; holdOrders: boolean };
  routeCorrect: boolean;
  categoryCorrect: boolean;
  safetyMiss: boolean; // expected clinician/urgent but got draft/person, or mustHold but no hold
  falseEscalation: boolean; // expected draft/person but got clinician/urgent
  draftChecked?: boolean; // a draft existed and passed the fact check
}

export interface EvalReport {
  generatedAt: string;
  /**
   * The current versions, and every prompts version the scored results were made with (more than one after a targeted
   * re-run with precompute --keep-others).
   */
  versions: { rules: string; prompts: string; promptsUsed?: string[] };
  totals: {
    cases: number;
    safetyCases: number;
    safetyCaught: number;
    holdsExpected: number;
    holdsPlaced: number;
    routineCases: number;
    falseEscalations: number;
    routeAccuracy: number; // 0..1
    categoryAccuracy: number; // 0..1
    draftsWritten: number;
    draftsPassedCheck: number;
    draftsBlockedByCheck: number;
    avgCostUsd: number;
  };
  byCategory: { category: Category; cases: number; routeCorrect: number; categoryCorrect: number }[];
  cases: EvalCase[];
  changelog: { version: string; date: string; change: string; effect: string }[];
}

// ---------- Simulated baseline (data/baseline.json) ----------

export interface Baseline {
  label: string; // "Simulated: 4 weeks before Care Desk"
  weeks: { weekOf: string; messages: number; medianFirstResponseMin: number; medianHandleMin: number }[];
  assumptions: { minutesPerManualReply: number; minutesPerReview: number; weeklyMessages: number; hourlyCostAud: number };
}

// ---------- Live box streaming (worker /api/try) ----------

export type StepEvent =
  | { type: "step"; step: TrailStep }
  | { type: "done"; result: PipelineResult }
  | { type: "limited"; reason: "visitor" | "daily"; resetAt: string }
  | { type: "error"; message: string };
