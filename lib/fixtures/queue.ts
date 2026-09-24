/**
 * The desk's queue model. Each message runs through the pipeline on its own, so a single result cannot know that a
 * later message from the same family reports the patient's death, or that the patient reported a serious reaction
 * two days ago. This module looks across ALL results for a patient and derives what the desk may do with each item.
 *
 *   Bereavement reported (an urgent result that may report the patient's death: reportsPatientDeath in
 *   lib/pipeline/death.ts) on another message:
 *     every other draft or person reply for that patient is WITHDRAWN. Send is never offered.
 *     A living patient writing about someone else's death while using their own treatment (MSG-0172) is not one: the
 *     rules label it an adverse event, and it raises the check-first alert below instead.
 *   Any other urgent message (a crisis, a serious reaction, or anything the sorter routed urgent whatever its label),
 *   or a clinician stop with orders held, on another message:
 *     that patient's other drafts are marked "Check with clinician before sending". Send is not offered from the
 *     queue; the agent checks with the on-call clinician first. These are the same triggers applyPatientHolds uses.
 *
 * Tuned like the safety rules: it over-escalates. A bereavement hit that turns out to be about someone else (a
 * patient's father, say) still withdraws the drafts until a clinician clears that message (see `cleared`).
 *
 * Pure functions over the shared types: safe in Node 24, the browser and a Cloudflare Worker.
 * Every patient, message and result is fictional demo material.
 */
import type { PatientMessage, PipelineResult, Route, SafetyCategory } from "@/lib/types";
import { falseAlarmKeepsAlert, reportsPatientDeath } from "@/lib/pipeline/death";

export type QueueStatus =
  | "ready" // a checked draft, nothing else known about the patient: Send is offered
  | "check_first" // a checked draft, but the patient has an open urgent safety message: check with the clinician
  | "withdrawn" // a bereavement was reported for this patient: nothing is sent to them
  | "needs_person" // no AI draft: an agent writes the reply
  | "clinician" // clinician queue
  | "urgent"; // clinician queue, top priority, orders on hold

export type PatientAlertKind = "bereavement" | "urgent_safety";

/** Something another message says about this patient that changes what the desk may send. */
export interface PatientAlert {
  kind: PatientAlertKind;
  /** The message that raised it. */
  messageId: string;
  receivedAt: string;
  /** The safety categories found in that message (rule hits and the sorter's label), most serious first. */
  categories: SafetyCategory[];
  /** Where that message went: urgent, or the clinician queue with orders held. */
  route: Extract<Route, "urgent" | "clinician">;
}

export interface QueueLock {
  kind: "withdrawn" | "check_clinician";
  /** Short badge text: "Withdrawn: bereavement reported (MSG-0156)", "Check with clinician before sending". */
  label: string;
  /** One plain sentence for the agent. */
  detail: string;
  /** The message that caused the lock. */
  messageId: string;
}

export interface QueueItem {
  messageId: string;
  patientId: string;
  message: PatientMessage;
  result: PipelineResult;
  route: Route;
  status: QueueStatus;
  /**
   * True only for a checked draft with no patient-level lock. The desk offers Send (and Ctrl+Enter) only when this
   * is true. A withdrawn or check-first item is never sendable from the queue.
   */
  sendable: boolean;
  /** Why this reply may not be sent from the queue, when it is a draft or a person reply. */
  lock?: QueueLock;
  /** Alerts raised by the patient's OTHER messages (never this one), most recent first. For context on any item. */
  patientAlerts: PatientAlert[];
  /**
   * Marking THIS message a false alarm still leaves an alert standing: it may report the patient's death and also has
   * another safety reading, so the clear takes out only the death reading (falseAlarmKeepsAlert in
   * lib/pipeline/death.ts). False for a living patient's report such as MSG-0172, where a clear releases everything.
   */
  falseAlarmKeepsAlert: boolean;
}

export interface BuildQueueOptions {
  /**
   * Message ids a clinician has reviewed and cleared (for example a bereavement hit about the patient's father).
   * Alerts from these messages no longer lock the patient's other items.
   */
  cleared?: Iterable<string>;
}

/** Most serious first. */
const SAFETY_ORDER: readonly SafetyCategory[] = ["crisis", "bereavement", "adverse_event", "side_effect", "clinical_question"];

/** The safety categories a result carries, from the rule hits and, when the sorter made the call, its verdict. */
function safetyCategories(result: PipelineResult): SafetyCategory[] {
  const found = new Set<string>(result.rules.hits.map((h) => h.category));
  if (result.sort) found.add(result.sort.category);
  return SAFETY_ORDER.filter((c) => found.has(c));
}

/**
 * The patient-level alerts a single result raises. The triggers match applyPatientHolds in lib/pipeline/run.ts, so the
 * queue never offers Send where the flattened results hold the draft:
 *  - bereavement: reportsPatientDeath, an urgent result with a bereavement hit or verdict, unless the writer is the
 *    living patient (using their own treatment, or writing about a relative's death and signing with their own name);
 *    it over-escalates on purpose otherwise, see the header;
 *  - urgent safety: any other urgent result, whatever its category label, or a clinician result with orders held.
 */
export function alertsFor(result: PipelineResult, message: PatientMessage): PatientAlert[] {
  const urgent = result.route === "urgent";
  const clinicianHold = result.route === "clinician" && result.holdOrders;
  if (!urgent && !clinicianHold) return [];
  const cats = safetyCategories(result);
  const route = urgent ? "urgent" : "clinician";
  const base = { messageId: message.id, receivedAt: message.receivedAt, categories: cats, route } as const;
  const out: PatientAlert[] = [];
  const bereavement = reportsPatientDeath(result);
  if (bereavement) out.push({ kind: "bereavement", ...base });
  // A bereavement-only report already withdraws everything; any other urgent or held result asks for a check.
  const otherSafety = cats.some((c) => c !== "bereavement");
  if (!bereavement || otherSafety) out.push({ kind: "urgent_safety", ...base });
  return out;
}

function byRecent(a: PatientAlert, b: PatientAlert): number {
  return Date.parse(b.receivedAt) - Date.parse(a.receivedAt);
}

function safetyWords(alert: PatientAlert): string {
  const has = (c: SafetyCategory) => alert.categories.includes(c);
  if (has("crisis") && has("adverse_event")) return "crisis language and a possible serious reaction";
  if (has("crisis")) return "crisis language";
  if (has("adverse_event")) return "a possible serious reaction";
  // Only a patient writing about someone else's death raises this alert with bereavement alone (reportsPatientDeath).
  if (has("bereavement") && alert.categories.every((c) => c === "bereavement")) return "news of a death close to them";
  if (alert.route === "urgent") {
    if (has("side_effect")) return "a side effect the safety check marked urgent";
    return "something the safety check marked urgent";
  }
  if (has("side_effect")) return "a side effect held for a clinician, with orders on hold";
  if (has("clinical_question")) return "a clinical question held for a clinician, with orders on hold";
  return "a message held for a clinician, with orders on hold";
}

function withdrawnLock(alert: PatientAlert): QueueLock {
  return {
    kind: "withdrawn",
    label: `Withdrawn: bereavement reported (${alert.messageId})`,
    detail: `${alert.messageId} reports a death. Nothing is sent to this patient unless the clinician handling that message finds it was about someone else.`,
    messageId: alert.messageId,
  };
}

function checkLock(alert: PatientAlert): QueueLock {
  return {
    kind: "check_clinician",
    label: "Check with clinician before sending",
    detail: `${alert.messageId} from this patient has ${safetyWords(alert)}. Check that the on-call clinician has been in touch before this reply goes.`,
    messageId: alert.messageId,
  };
}

/**
 * Builds the queue from every result, deriving patient-level state first. Results without a matching message are
 * skipped. The returned order follows `results`; sort it with `compareQueueItems` for display.
 */
export function buildQueue(
  results: readonly PipelineResult[],
  messages: readonly PatientMessage[],
  opts: BuildQueueOptions = {},
): QueueItem[] {
  const cleared = new Set(opts.cleared ?? []);
  const byId = new Map(messages.map((m) => [m.id, m]));

  // Patient-level state from all results.
  const alertsByPatient = new Map<string, PatientAlert[]>();
  for (const r of results) {
    const m = byId.get(r.messageId);
    if (!m || cleared.has(m.id)) continue;
    const alerts = alertsFor(r, m);
    if (!alerts.length) continue;
    const list = alertsByPatient.get(m.patientId) ?? [];
    list.push(...alerts);
    alertsByPatient.set(m.patientId, list);
  }

  const items: QueueItem[] = [];
  for (const r of results) {
    const m = byId.get(r.messageId);
    if (!m) continue;
    const others = (alertsByPatient.get(m.patientId) ?? []).filter((a) => a.messageId !== m.id).sort(byRecent);
    const bereavement = others.find((a) => a.kind === "bereavement");
    const safety = others.find((a) => a.kind === "urgent_safety");
    const checkedDraft = r.route === "draft" && Boolean(r.draft?.text) && !r.draft?.declined && r.check?.passed === true;

    let status: QueueStatus;
    let lock: QueueLock | undefined;
    switch (r.route) {
      case "urgent":
        status = "urgent";
        break;
      case "clinician":
        status = "clinician";
        break;
      case "person":
        status = bereavement ? "withdrawn" : "needs_person";
        lock = bereavement ? withdrawnLock(bereavement) : safety ? checkLock(safety) : undefined;
        break;
      case "draft":
      default:
        if (bereavement) {
          status = "withdrawn";
          lock = withdrawnLock(bereavement);
        } else if (!checkedDraft) {
          status = "needs_person";
          lock = safety ? checkLock(safety) : undefined;
        } else if (safety) {
          status = "check_first";
          lock = checkLock(safety);
        } else {
          status = "ready";
        }
    }

    items.push({
      messageId: m.id,
      patientId: m.patientId,
      message: m,
      result: r,
      route: r.route,
      status,
      sendable: status === "ready" && checkedDraft,
      lock,
      patientAlerts: others,
      falseAlarmKeepsAlert: falseAlarmKeepsAlert(r),
    });
  }
  return items;
}

/**
 * Display order: urgent, clinician, then work the agent can do now (replies to write, then ready drafts), then rows the
 * agent cannot act on yet (held until the clinician has been in touch, then withdrawn); oldest first within each.
 * Only the order changes here: the patient-level locks themselves are derived in buildQueue.
 */
const STATUS_RANK: Record<QueueStatus, number> = {
  urgent: 0,
  clinician: 1,
  needs_person: 2,
  ready: 3,
  check_first: 4,
  withdrawn: 5,
};

export function compareQueueItems(a: QueueItem, b: QueueItem): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || Date.parse(a.message.receivedAt) - Date.parse(b.message.receivedAt);
}

/**
 * Plain words for each status, for queue rows and filters, named by what the agent does next. The same words as
 * RISK_META and LOCK_META in components/ui/RiskBadge.tsx and ROUTE_LABEL in lib/format.ts.
 */
export const QUEUE_STATUS_LABEL: Record<QueueStatus, string> = {
  ready: "Ready to send",
  check_first: "Held: clinician first",
  withdrawn: "Withdrawn",
  needs_person: "Write the reply",
  clinician: "Clinician",
  urgent: "Urgent",
};
