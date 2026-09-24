/**
 * The desk and clinician queues in the browser: queue.json rows re-derived with what happened in this session.
 *
 *  deriveQueue(rows, cleared, contacted)  re-runs the patient-level locks of lib/fixtures/queue.ts (buildQueue itself)
 *                              on the slim rows, so a clinician clearing a false alarm, or reaching the patient,
 *                              releases the patient's other drafts.
 *  applySession(rows, data)    adds each row's decision and clinician record, and works out where it now belongs.
 *
 * Pure functions, no React: safe in tests. Every patient and message is fictional.
 */
import type { PatientMessage, PipelineResult, RuleHit } from "@/lib/types";
import { buildQueue, QUEUE_STATUS_LABEL } from "@/lib/fixtures/queue";
import { falseAlarmKeepsAlert, livingPatientSeedHit, reportsPatientDeath } from "@/lib/pipeline/death";
import type { QueueRow } from "./types";
import { clearedIds, contactedIds, type ClinicianRecord, type Decision, type SessionData } from "./session-state";

/**
 * The seed's safety categories as stand-in rule hits, plus the living-patient hit when the seed carries one, so the
 * death helpers in lib/pipeline/death.ts read a seed exactly as they read the full result.
 */
function seedHits(seed: QueueRow["seed"]): RuleHit[] {
  const hits = seed.safety.map((category): RuleHit => ({ ruleId: `seed.${category}`, category, phrase: "", start: -1, end: -1 }));
  if (seed.livingPatient) hits.push(livingPatientSeedHit());
  return hits;
}

/**
 * A stand-in PipelineResult carrying only what buildQueue reads: route, holdOrders, the safety categories (as rule hits)
 * and whether a checked draft exists. tests/client-queue.test.ts proves the output matches the full results.
 */
function seedResult(row: QueueRow): PipelineResult {
  const hits = seedHits(row.seed);
  const checked = row.seed.checkedDraft;
  return {
    messageId: row.messageId,
    redactedText: "",
    redactions: [],
    rules: { matched: hits.length > 0, hits },
    route: row.route,
    holdOrders: row.holdOrders,
    draft: checked ? { text: "seed", citations: [] } : undefined,
    check: checked ? { facts: [], banned: [], passed: true } : undefined,
    trail: [],
    models: {},
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    versions: { rules: "", prompts: "" },
    mode: "deterministic_only",
  };
}

function seedMessage(row: QueueRow): PatientMessage {
  return { id: row.messageId, patientId: row.patientId, channel: row.channel, receivedAt: row.receivedAt, body: "" };
}

/**
 * A false-alarm clear that keeps part of the alert: an urgent message that may report the patient's death AND carries
 * another safety reading (a side effect, say). The bereavement reading goes, but the rest still needs a clinician to be
 * in touch. False for a living patient's report (MSG-0172: her brother died, she is taking more oil than prescribed):
 * the death was never the alert, so a clear releases everything, like any other false alarm. Same rule as
 * falseAlarmKeepsAlert in lib/pipeline/death.ts, read from the seed.
 */
export function clearKeepsAlert(row: Pick<QueueRow, "route" | "seed">): boolean {
  return falseAlarmKeepsAlert({ route: row.route, rules: { hits: seedHits(row.seed) } });
}

const withSafety = (row: QueueRow, safety: QueueRow["seed"]["safety"]): QueueRow => ({ ...row, seed: { ...row.seed, safety } });

/**
 * Re-derives status, statusLabel, lock, sendable and patientAlerts with what clinicians did in this session.
 *
 *  cleared    messages a clinician marked as a false alarm. The bereavement reading goes. A message that was only that
 *             (or only a figure of speech) no longer locks anything and drops out of the patient's alerts. A message
 *             with another safety reading as well keeps it (see clearKeepsAlert), so the patient's other replies move
 *             from withdrawn to "Check with clinician before sending".
 *  contacted  messages whose clinician has been in touch with the patient (a call that reached them, or a reply):
 *             their "Check with clinician before sending" locks lift, so the patient's other drafts can be sent and
 *             person replies written. A reported death still withdraws everything until it is cleared, and the alert
 *             stays in patientAlerts as context.
 *
 * With nothing cleared or contacted it returns the rows unchanged (same array). Order is kept: rows are already in
 * display order, and a released draft stays where it was rather than jumping while someone is working.
 */
export function deriveQueue(
  rows: readonly QueueRow[],
  cleared: Iterable<string> = [],
  contacted: Iterable<string> = [],
): QueueRow[] {
  const clearedSet = new Set(cleared);
  const contactedSet = new Set(contacted);
  if (!clearedSet.size && !contactedSet.size) return rows as QueueRow[];
  const messages = rows.map(seedMessage);
  // What each message still says after this session's clears: fully cleared ids, and the rows with bereavement taken
  // out where the clear keeps another reading.
  const fullyCleared = new Set<string>();
  const kept = rows.map((row) => {
    if (!clearedSet.has(row.messageId)) return row;
    if (clearKeepsAlert(row)) return withSafety(row, row.seed.safety.filter((c) => c !== "bereavement"));
    fullyCleared.add(row.messageId);
    return row;
  });
  // Context: every alert still standing.
  const context = clearedSet.size ? buildQueue(kept.map(seedResult), messages, { cleared: fullyCleared }) : undefined;
  // Locks: a contacted message raises only its bereavement alert (if it still has one), so its check-first locks lift.
  let locks = context;
  if (contactedSet.size) {
    const lockCleared = new Set(fullyCleared);
    const seeds = kept.map((row) => {
      if (!contactedSet.has(row.messageId) || fullyCleared.has(row.messageId)) return seedResult(row);
      if (reportsPatientDeath(seedResult(row))) return seedResult(withSafety(row, ["bereavement"]));
      lockCleared.add(row.messageId);
      return seedResult(row);
    });
    locks = buildQueue(seeds, messages, { cleared: lockCleared });
  }
  return rows.map((row, i) => {
    const it = locks![i];
    const next: QueueRow = {
      ...row,
      status: it.status,
      statusLabel: QUEUE_STATUS_LABEL[it.status],
      sendable: it.sendable,
      patientAlerts: context ? context[i].patientAlerts : row.patientAlerts,
    };
    if (it.lock) next.lock = it.lock;
    else delete next.lock;
    return next;
  });
}

export interface DeskRow extends QueueRow {
  decision?: Decision;
  clinicianRecord?: ClinicianRecord;
  /**
   * An agent has sent a reply (as drafted, edited or written). The row stays in the data so the desk can show it as
   * done; filter on this for the open queue.
   */
  replied: boolean;
  /**
   * Listed in the clinician queue: a safety route (clinician or urgent), or escalated by an agent. Safety messages
   * still show on the desk too, with the stopped trail and no reply actions.
   */
  inClinicianQueue: boolean;
  /** The agent sent it to the clinician queue (it was not a safety route). */
  escalatedByAgent: boolean;
  /** Staff id the message was handed to, when reassigned. */
  assignedTo?: string;
  /** The pipeline held the orders and no clinician has resumed them. */
  holdActive: boolean;
  /** A clinician has replied to the patient. */
  clinicianReplied: boolean;
  /** A clinician marked this message's alert as a false alarm. */
  cleared: boolean;
  /**
   * Cleared, but only the bereavement reading went: the message has another safety reading, so it still needs a
   * clinician in touch and the patient's other replies stay "Check with clinician before sending" (clearKeepsAlert).
   */
  clearKeepsAlert: boolean;
}

/** What the desk may do with a row's reply. */
export type ReplyPermission =
  /** A checked draft with no lock: Send, Edit, Escalate. */
  | "send_draft"
  /** No AI draft and no lock: the agent writes the reply. */
  | "write_reply"
  /** Check with the clinician first, withdrawn, a clinician item, or already decided: nothing is sent from the desk. */
  | "blocked";

export function replyPermission(row: QueueRow & { decision?: Decision }): ReplyPermission {
  if (row.decision && row.decision.kind !== "reassigned") return "blocked";
  if (row.status === "ready" && row.sendable) return "send_draft";
  if (row.status === "needs_person" && !row.lock) return "write_reply";
  return "blocked";
}

/**
 * The last gate below the desk UI: may a reply to `messageId` be sent right now, with this session applied? False for
 * a message that is not in the queue, is locked (held until a clinician has been in touch, or withdrawn), or that the
 * desk may not reply to at all (a clinician item, or one already decided). The session provider checks it inside
 * send and sendEdited, so a locked reply is refused even if a screen forgets to check.
 */
export function canSendReply(rows: readonly QueueRow[], data: SessionData, messageId: string): boolean {
  const row = applySession(rows, data).find((r) => r.messageId === messageId);
  return !!row && !row.lock && replyPermission(row) !== "blocked";
}

/** Rows with this session's decisions, clinician actions and clears applied. */
export function applySession(rows: readonly QueueRow[], data: SessionData): DeskRow[] {
  const derived = deriveQueue(rows, clearedIds(data), contactedIds(data));
  return derived.map((row) => {
    const decision = data.decisions[row.messageId];
    const rec = data.clinician[row.messageId];
    const safetyRoute = row.status === "clinician" || row.status === "urgent";
    const escalatedByAgent = !safetyRoute && decision?.kind === "escalated";
    const out: DeskRow = {
      ...row,
      replied: decision?.kind === "sent" || decision?.kind === "sent_edited",
      inClinicianQueue: safetyRoute || escalatedByAgent,
      escalatedByAgent,
      holdActive: row.holdOrders && !rec?.holdResumed,
      clinicianReplied: (rec?.replies.length ?? 0) > 0,
      cleared: Boolean(rec?.cleared),
      clearKeepsAlert: Boolean(rec?.cleared) && clearKeepsAlert(row),
    };
    if (decision) out.decision = decision;
    if (rec) out.clinicianRecord = rec;
    if (decision?.kind === "reassigned") out.assignedTo = decision.to;
    return out;
  });
}

/** Clinician queue order: urgent first, then oldest first, keeping the desk's order otherwise. */
export function clinicianRows(rows: readonly DeskRow[]): DeskRow[] {
  const rank = (r: DeskRow) => (r.status === "urgent" ? 0 : r.escalatedByAgent ? 2 : 1);
  return rows
    .filter((r) => r.inClinicianQueue)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || Date.parse(a.r.receivedAt) - Date.parse(b.r.receivedAt) || a.i - b.i)
    .map(({ r }) => r);
}

/** Rows still waiting for someone on the desk: not replied, not escalated by an agent. Keeps display order. */
export function openDeskRows(rows: readonly DeskRow[]): DeskRow[] {
  return rows.filter((r) => !r.replied && !r.escalatedByAgent);
}
