/**
 * Shapes of the files in public/data/, written by scripts/build-public-data.ts and read by lib/client/data.ts.
 * Screens fetch these at run time instead of importing data/results.json (about 1.4 MB) into the bundle.
 * Every patient, message and result is fictional demo material.
 */
import type {
  Baseline,
  Category,
  Channel,
  Country,
  EvalReport,
  Patient,
  PatientMessage,
  PipelineResult,
  Plan,
  Order,
  Charge,
  Appointment,
  Risk,
  Route,
  SafetyCategory,
  SourceRef,
  StepId,
  TestLabel,
  ThreadEntry,
} from "@/lib/types";
import type { PatientAlert, QueueLock, QueueStatus } from "@/lib/fixtures/queue";

export type { PatientAlert, QueueLock, QueueStatus } from "@/lib/fixtures/queue";

/** Bumped when a public file changes shape. */
export const PUBLIC_DATA_VERSION = 1;

// ---------- public/data/queue.json ----------

/** Why a message stopped or went to a person, for queue rows and the clinician's "why it was escalated". */
export interface QueueReason {
  /** The headline category: the most specific safety category for a stop, otherwise the sorter's label. */
  category?: Category;
  /** The matched words that stopped the trail (from the headline rule hit), when the rules stopped it. */
  phrase?: string;
  /**
   * Where the phrase sits: "message" (highlight it in messageText(message)), "thread" (an earlier message in the
   * conversation, start < 0, not highlighted) or undefined when no rule matched.
   */
  phraseIn?: "message" | "thread";
  /** The one-line summary of the step that decided the route (the stopped step, else the decide step). */
  summary: string;
  /** The step where the trail stopped, when it did. */
  stoppedAt?: StepId;
}

/** One row of the desk and clinician queues. Slim on purpose: the full ticket is in cases/<messageId>.json. */
export interface QueueRow {
  messageId: string;
  patientId: string;
  /** The patient's first name, for the row and to fill [FIRST_NAME] in drafts. */
  firstName: string;
  country: Country;
  channel: Channel;
  receivedAt: string;
  subject?: string;
  /** The body on one line, cut at a word near 140 characters and ended with "…" when cut. */
  preview: string;
  /** resultCategory(result): the sorter's label, or the headline safety category after a stop. */
  category?: Category;
  route: Route;
  risk: Risk;
  /** The pipeline asked for the patient's orders to be held. */
  holdOrders: boolean;
  /** Queue status after patient-level locks (bereavement withdrawal, check with clinician first). */
  status: QueueStatus;
  /** QUEUE_STATUS_LABEL[status]. */
  statusLabel: string;
  /** Why this reply may not be sent from the queue. */
  lock?: QueueLock;
  /** Alerts from the patient's OTHER messages, most recent first. */
  patientAlerts: PatientAlert[];
  /** The sorter's confidence, 0..1, when the sorter ran. */
  confidence?: number;
  /** True only for a checked draft with no patient-level lock: the desk offers Send only then. */
  sendable: boolean;
  /**
   * Marking THIS message a false alarm still leaves an alert standing (falseAlarmKeepsAlert in lib/pipeline/death.ts):
   * it may report the patient's death and has another safety reading. False for a living patient's report (MSG-0172).
   */
  falseAlarmKeepsAlert: boolean;
  reason: QueueReason;
  /** Earlier messages in the conversation (0 when it is the first). */
  threadLength: number;
  /** The draft or the sorter came from the labelled sample (mock) models. */
  sample: boolean;
  /**
   * Inputs the client needs to re-derive status, lock, sendable and patientAlerts when a clinician clears a message
   * (lib/client/queue.ts deriveQueue). Not for display.
   */
  seed: QueueSeed;
}

export interface QueueSeed {
  /** A draft exists, was not declined and passed the fact check. */
  checkedDraft: boolean;
  /** A draft was written but declined or blocked by the fact check, so a person replies. */
  blockedDraft?: true;
  /** Safety categories from the rule hits and the sorter's label, most serious first. */
  safety: SafetyCategory[];
  /** Mentions a death, but the writer is the living patient using their own treatment (MSG-0172): no bereavement withdrawal. */
  livingPatient?: true;
}

export interface QueueFile {
  version: number;
  /** Desk rows in display order (compareQueueItems: urgent, clinician, held: clinician first, write the reply, ready, withdrawn). */
  items: QueueRow[];
}

// ---------- public/data/cases/<MSG-id>.json ----------

/** The patient as the desk shows them: no identifiers (Medicare, NHI, NHS), no date of birth, no author notes. */
export interface CasePatient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: Country;
  timezone: string;
  suburb: string;
  region: string;
  /** For the UK, the postcode area picks the nation's regional helpline more exactly than place names do. */
  postcode: string;
  plan: Plan;
  /** Newest first. */
  orders: Order[];
  /** Newest first. */
  charges: Charge[];
  /** Soonest or most recent first (by date, newest first). */
  appointments: Appointment[];
}

/** Another message from the same patient, for "Other messages from this patient". */
export interface CaseSibling {
  messageId: string;
  receivedAt: string;
  channel: Channel;
  subject?: string;
  preview: string;
  route: Route;
  /** Absent for a test-only message. */
  status?: QueueStatus;
  statusLabel?: string;
  testOnly: boolean;
}

export interface CaseFile {
  version: number;
  messageId: string;
  message: PatientMessage;
  /** messageText(message): subject + "\n\n" + body for email. Rule-hit start/end index into this. Pass to <Trail messageText>. */
  text: string;
  /** Earlier messages in the conversation, oldest first ([] when none). */
  thread: ThreadEntry[];
  result: PipelineResult;
  patient: CasePatient;
  /** The queue row for this message (status, lock, alerts). Absent for a test-only (red-team) message. */
  row?: QueueRow;
  /** Alerts from the patient's other desk messages, most recent first (same as row.patientAlerts when there is a row). */
  patientAlerts: PatientAlert[];
  /** Why a reply may not be sent from the queue (same as row.lock). */
  lock?: QueueLock;
  /** The patient's other messages, oldest first. */
  siblings: CaseSibling[];
  /** The test-set label, for Test results (expected vs actual). */
  label?: TestLabel;
  /** Red-team slice (MSG-0901 onwards): shown on Test results only, never in the desk queue. */
  testOnly: boolean;
}

// ---------- public/data/eval-report.json ----------

/** A short line per test case so the Test results table needs no case files until a row is opened. */
export interface EvalCaseMeta {
  firstName: string;
  country: Country;
  channel: Channel;
  subject?: string;
  preview: string;
  testOnly: boolean;
}

export interface PublicEvalReport extends EvalReport {
  /** Keyed by messageId. */
  caseMeta: Record<string, EvalCaseMeta>;
}

// ---------- public/data/baseline.json, helplines.json, staff.json ----------

export type PublicBaseline = Baseline;

export type HelplineKind = "emergency" | "crisis" | "poisons" | "health_advice" | (string & {});

export interface Helpline {
  country: Country;
  kind: HelplineKind;
  name: string;
  number: string;
  hours: string;
  url: string;
  verifiedOn: string;
  note?: string;
  /** Set when the line serves only part of the country. */
  region?: string;
}

export type StaffRole = "agent" | "clinician" | "lead" | "privacy_officer";

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  country: Country;
  title: string;
}

// ---------- public/data/personas.json ----------

/** One of the three sample patients offered in the Try box. */
export interface Persona {
  /** The full fictional record (minus the author note), so redaction and retrieval can run on it. */
  patient: Omit<Patient, "authorNote">;
  /** Every record the drafter may cite, in the exact wording it is given (plan, then orders, charges, appointments). */
  sources: SourceRef[];
}

export interface PersonasFile {
  version: number;
  personas: Persona[];
}

// ---------- public/data/meta.json ----------

export interface PublicMeta {
  version: number;
  /** When data/results.json was generated (not when this file was written, so the build is deterministic). */
  generatedAt: string;
  evalGeneratedAt: string;
  versions: { rules: string; prompts: string };
  models: { sort: string; draft: string };
  /** The results came from the sample (mock) models: show the small "Sample results" notice. */
  isMock: boolean;
  /** The demo's fixed "now" (lib/format DEMO_NOW). */
  demoNow: string;
  counts: { queue: number; cases: number; testOnly: number };
  /** The first id of the test-only red-team slice. */
  testOnlyFrom: string;
  /**
   * What the welcome page shows, so it needs only this small file and the two case files (not queue.json or
   * eval-report.json) on first load.
   */
  welcome: PublicWelcome;
}

export interface PublicWelcome {
  /** The live mini trail's two messages (components/tour/steps.ts resolveWelcomeIds on the queue). */
  routine: string;
  clinical: string;
  /** The test-set totals the welcome's safety fact quotes (the same numbers as eval-report.json). */
  totals: Pick<EvalReport["totals"], "cases" | "safetyCases" | "safetyCaught" | "holdsExpected" | "holdsPlaced">;
}
