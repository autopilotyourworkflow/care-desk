/**
 * The desk's view model: queue filters, search, sort, "done", and the small text helpers the reply panel needs.
 * Pure functions (no React), so they are easy to test. Every patient and message is fictional demo material.
 */
import type { Country, Currency, OrderStatus, PlanStatus, SourceRef } from "@/lib/types";
import type { DeskRow, ReplyPermission } from "@/lib/client/queue";
import type { CasePatient, CaseSibling, StaffMember } from "@/lib/client/types";
import type { QueueLock } from "@/lib/fixtures/queue";
import type { CheckResult } from "@/lib/types";
import { minutesSince, unfilledPlaceholders } from "@/lib/format";
import { checkDraft, clinicianReason, isClinicalBan, policyReason } from "@/lib/pipeline/check";

// ---------- Can a reply go now? ----------

export interface SendState {
  /** replyPermission(row) as it stands in this render (or at the moment of the click). */
  permission: ReplyPermission;
  /** The patient-level lock on the row, if any. */
  lock?: QueueLock | null;
  /** The message already has a final decision (sent, escalated, or passed on with no hand-over open). */
  decided?: boolean;
}

/**
 * Why nothing may be sent to the patient right now, in plain words, or null when a reply may go. Checked on every
 * render and again inside every send, so a lock that arrives while an agent is editing (a clinician's call undone in
 * another tab, a demo reset) switches Send off at once. The lock is checked first: it outranks whatever was allowed
 * when the edit began, and it outranks the permission too.
 */
export function sendBlockReason({ permission, lock, decided = false }: SendState): string | null {
  if (lock?.kind === "withdrawn") return `A death was reported in ${lock.messageId}, so nothing is sent to this patient.`;
  if (lock) return `Held: a clinician must be in touch with the patient about ${lock.messageId} first.`;
  if (decided) return "This message already has a decision.";
  if (permission === "blocked") return "This message cannot be sent from the desk now.";
  return null;
}

/** What the reply panel's decide step shows. */
export type DecideView =
  | "record"
  | "test_only"
  | "clinician"
  | "escalate"
  | "reassign"
  | "edit"
  | "held"
  | "send"
  | "write"
  | "none";

export interface DecideState {
  /** The message has a final decision in this session. */
  final: boolean;
  testOnly: boolean;
  /** A clinician or urgent route: a clinician owns the reply. */
  safety: boolean;
  mode: "idle" | "edit" | "escalate" | "reassign";
  /** sendBlockReason for this render. */
  sendOff: string | null;
  lock?: QueueLock | null;
  permission: ReplyPermission;
  /** A checked AI draft exists. */
  hasDraft: boolean;
}

/**
 * Which decide step to render. The editor shows only while a reply may go (sendOff is null), and the held view comes
 * before the send and write views: a lock that arrives mid-edit always wins, so no frame ever shows an active Send beside
 * the lock. (The panel also leaves edit mode then, keeping the text; see ReplyPanel.)
 */
export function decideView(s: DecideState): DecideView {
  if (s.final) return "record";
  if (s.testOnly) return "test_only";
  if (s.safety) return "clinician";
  if (s.mode === "escalate") return "escalate";
  if (s.mode === "reassign") return "reassign";
  if (s.mode === "edit" && !s.sendOff) return "edit";
  if (s.lock) return "held";
  if (s.sendOff) return "none";
  if (s.permission === "send_draft" && s.hasDraft) return "send";
  if (s.permission === "write_reply") return "write";
  return "none";
}

/** The patient's other desk messages, each with its live row from this session when there is one. */
export function liveSiblings(
  siblings: readonly CaseSibling[],
  rows: readonly DeskRow[],
  selfId: string,
): { sibling: CaseSibling; row?: DeskRow }[] {
  const byId = new Map(rows.map((r) => [r.messageId, r]));
  return siblings
    .filter((s) => !s.testOnly && s.messageId !== selfId)
    .map((sibling) => {
      const row = byId.get(sibling.messageId);
      return row ? { sibling, row } : { sibling };
    });
}

// ---------- Filters ----------

export type DeskFilter = "all" | "person" | "ready" | "safety" | "done";

export const FILTERS: { id: DeskFilter; label: string; description: string }[] = [
  { id: "all", label: "All", description: "Every message still open on the desk" },
  { id: "person", label: "Write the reply", description: "No AI draft, waiting on a clinician, or passed to a colleague" },
  { id: "ready", label: "Ready to send", description: "A checked draft is waiting for your review" },
  { id: "safety", label: "Clinician and urgent", description: "Stopped by the safety rules. A clinician answers" },
  { id: "done", label: "Done", description: "Sent or escalated in this demo" },
];

export function isDeskFilter(v: unknown): v is DeskFilter {
  return v === "all" || v === "person" || v === "ready" || v === "safety" || v === "done";
}

/**
 * The desk has finished with it: sent, or escalated to a clinician. A message passed to a colleague stays open (under
 * "Write the reply", with a "Passed to" badge), because that colleague still has to reply.
 */
export function isDone(row: DeskRow): boolean {
  return row.replied || row.escalatedByAgent;
}

/** Passed to a colleague in this session: still open, now theirs to answer. */
export function isPassedOn(row: DeskRow): boolean {
  return row.decision?.kind === "reassigned";
}

export function isSafety(row: DeskRow): boolean {
  return row.status === "urgent" || row.status === "clinician";
}

/**
 * Held for the patient's sake: another message from this patient is with a clinician (a check-first or withdrawn
 * lock), so the desk cannot send this one yet. These sit in their own group at the bottom of the queue.
 */
export function isHeld(row: DeskRow): boolean {
  return !isSafety(row) && Boolean(row.lock);
}

export function matchesFilter(row: DeskRow, filter: DeskFilter): boolean {
  const done = isDone(row);
  switch (filter) {
    case "all":
      return !done;
    case "person":
      return !done && (row.status === "needs_person" || row.status === "check_first" || isPassedOn(row));
    case "ready":
      return !done && row.status === "ready" && !isPassedOn(row);
    case "safety":
      return !done && isSafety(row);
    case "done":
      return done;
  }
}

export function filterCounts(rows: readonly DeskRow[]): Record<DeskFilter, number> {
  const out: Record<DeskFilter, number> = { all: 0, person: 0, ready: 0, safety: 0, done: 0 };
  for (const r of rows) for (const f of FILTERS) if (matchesFilter(r, f.id)) out[f.id]++;
  return out;
}

// ---------- Search ----------

/** Matches the first name, the message id (with or without "MSG-"), the patient id, the subject and the preview. */
export function matchesQuery(row: DeskRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const id = row.messageId.toLowerCase();
  if (id.includes(q) || id.replace("msg-", "") === q.replace(/^msg-?/, "")) return true;
  const hay = [row.firstName, row.patientId, row.subject ?? "", row.preview, row.country].join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

// ---------- Sort ----------

export type DeskSort = "priority" | "longest" | "newest";

export const SORTS: { id: DeskSort; label: string; description: string }[] = [
  { id: "priority", label: "Priority", description: "Urgent first, then checked drafts, then replies to write, then held" },
  { id: "longest", label: "Longest waiting", description: "Oldest message first" },
  { id: "newest", label: "Newest", description: "Most recent message first" },
];

export function isDeskSort(v: unknown): v is DeskSort {
  return v === "priority" || v === "longest" || v === "newest";
}

/**
 * Urgent, then clinician items always pin to the top, whatever the sort. Held rows (another message from the patient
 * is with a clinician) always sink to the bottom: nothing there can be sent yet.
 */
function pinRank(row: DeskRow): number {
  if (row.status === "urgent") return 0;
  if (row.status === "clinician") return 1;
  if (isHeld(row)) return 3;
  return 2;
}

/**
 * Inside the desk's own rows, Priority puts checked drafts first: each is a quick review and send, so the queue opens
 * on work that can be finished now. Replies to write (and rows passed to a colleague) follow.
 */
function priorityRank(row: DeskRow): number {
  return row.status === "ready" && !isPassedOn(row) ? 0 : 1;
}

/**
 * Rows arrive in display order (priority, then oldest first). Priority keeps urgent and clinician on top, then puts
 * checked drafts before replies to write, oldest first in each, and held rows at the bottom. The other sorts keep
 * urgent and clinician pinned on top and held rows at the bottom too.
 */
export function sortRows(rows: readonly DeskRow[], sort: DeskSort): DeskRow[] {
  const dir = sort === "longest" ? 1 : sort === "newest" ? -1 : 0;
  const sub = sort === "priority" ? priorityRank : () => 0;
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        pinRank(a.r) - pinRank(b.r) ||
        (pinRank(a.r) === 2 ? sub(a.r) - sub(b.r) : 0) ||
        dir * (Date.parse(a.r.receivedAt) - Date.parse(b.r.receivedAt)) ||
        a.i - b.i,
    )
    .map(({ r }) => r);
}

export function visibleRows(rows: readonly DeskRow[], filter: DeskFilter, query: string, sort: DeskSort): DeskRow[] {
  return sortRows(
    rows.filter((r) => matchesFilter(r, filter) && matchesQuery(r, query)),
    sort,
  );
}

/** A message has waited long enough to call out (over a day). */
export function isLongWait(receivedAt: string): boolean {
  return minutesSince(receivedAt) >= 24 * 60;
}

/** The best filter to show a deep-linked row in, when the current one hides it. */
export function filterFor(row: DeskRow): DeskFilter {
  if (isDone(row)) return "done";
  return "all";
}

/**
 * The message the desk opens after acting on `id`: the next row in `nav` (the rows J and K move through), else the
 * previous one. `nav` is read BEFORE the action, so a row that stays in the view (passed to a colleague) is never
 * chosen again.
 */
export function nextAfter(nav: readonly DeskRow[], id: string): DeskRow | undefined {
  const i = nav.findIndex((r) => r.messageId === id);
  if (i < 0) return nav.find((r) => r.messageId !== id);
  return nav[i + 1] ?? (i > 0 ? nav[i - 1] : undefined);
}

// ---------- Fact check on an edit ----------

/** What the edit path needs from a case file to check a reply: the patient's currency and the redacted message. */
export interface EditCheckContext {
  result: { redactedText: string };
  patient: { plan: { currency: Currency } };
}

/**
 * The fact check on the edit path, run the way the pipeline checks a draft (lib/pipeline/run.ts): the same sources,
 * plus the patient's own redacted message, so a date or time the patient wrote is "check first" rather than missing.
 * Every edit, restore and scratch reply goes through here, so no check on the desk forgets the patient's message.
 */
export function checkEdit(text: string, sources: SourceRef[], ctx: EditCheckContext): CheckResult {
  return checkDraft(text, sources, { currency: ctx.patient.plan.currency, patientText: ctx.result.redactedText });
}

// ---------- Draft text ----------

/** Removes the [1] style citation markers (and the space before them) so the patient never sees them. */
export function stripCitations(text: string): string {
  return text.replace(/[^\S\n]?\[\d+\]/g, "");
}

/** A starting point for a reply written by a person: greeting and sign-off already in place. */
export function starterReply(firstName: string, agentName: string): string {
  return `Hi ${firstName},\n\n\n\nKind regards,\n${agentName}`;
}

/** Where the caret goes in a starter reply: the empty line after the greeting. */
export function starterCaret(firstName: string): number {
  return `Hi ${firstName},\n\n`.length;
}

/** "[PHONE]", "[PHONE] and [CARD]", "[NAME], [PHONE] and [CARD]". */
function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const NAME_SLOTS = new Set(["[FIRST_NAME]", "[AGENT_NAME]"]);

/**
 * Why a reply cannot go while it still holds a placeholder, or null when none is left. The drafter's two name slots
 * are filled in by the desk; any other placeholder ("[PHONE]", "[CARD]", "[NAME]") stands for a detail that was hidden
 * before the AI saw the message, so it has to be written out or taken out. Checked on the AI draft as well as an edit.
 */
export function placeholderBlockReason(text: string): string | null {
  const left = unfilledPlaceholders(text);
  if (!left.length) return null;
  if (left.every((p) => NAME_SLOTS.has(p))) return "Fill in the name placeholders first.";
  const hidden = left.filter((p) => !NAME_SLOTS.has(p));
  const names = hidden.length < left.length;
  const what = `${joinAnd(hidden)} ${hidden.length === 1 ? "stands" : "stand"} for a detail hidden from the AI and must never reach the patient.`;
  return names
    ? `Fill in the name placeholders, and write out or take out ${joinAnd(hidden)}, first. ${what}`
    : `Write out or take out ${joinAnd(hidden)} first. ${what}`;
}

/**
 * The helper line under a reply the fact check blocked, and what the agent can do about it.
 *   clinical  the reply strays into clinical territory: the line says why and points to a clinician (as before).
 *   policy    a non-clinical policy block (a card number, a password, a promised deletion, a placeholder left in):
 *             the line says which policy, and the fix is a rewrite. Nothing here needs a clinician.
 *   other     anything else never allowed in a reply (promotional wording): take it out.
 */
export interface BanHelp {
  kind: "clinical" | "policy" | "other";
  line: string;
}

export function banHelp(check: Pick<CheckResult, "banned"> | null | undefined): BanHelp | null {
  if (!check?.banned.length) return null;
  const clinical = clinicianReason(check);
  if (clinical) return { kind: "clinical", line: `Take it out to send. ${clinical}` };
  const policy = policyReason(check);
  if (policy) return { kind: "policy", line: `${policy} Rewrite that part to send.` };
  return { kind: "other", line: "Take it out to send." };
}

/** A card number in any grouping, as the fact check reads one (CARD_NUMBER_RE in lib/pipeline/check.ts). */
const CARD_NUMBER = /(?<![\p{L}\p{N}_])[2-6](?:[ .\/-]{0,2}\d){12,18}(?!\d)/gu;

/**
 * Where the first blocked words that can be rewritten sit in the reply, so "Rewrite that part" can select them. Clinical
 * blocks are skipped (they go to a clinician). A card number is shown back only as its last four digits, so it is found
 * again by those. Null when nothing can be placed.
 */
export function rewriteSpan(text: string, banned: readonly string[]): { start: number; end: number } | null {
  const lower = text.toLowerCase();
  for (const entry of banned) {
    if (isClinicalBan(entry)) continue;
    const cut = entry.indexOf(": ");
    if (cut < 0) continue;
    const label = entry.slice(0, cut);
    const shown = entry.slice(cut + 2);
    if (label === "repeats a card number") {
      const last4 = shown.replace(/\D/g, "").slice(-4);
      for (const m of text.matchAll(CARD_NUMBER)) {
        if (m[0].replace(/\D/g, "").endsWith(last4)) return { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
      }
      continue;
    }
    const at = lower.indexOf(shown.toLowerCase());
    if (at >= 0) return { start: at, end: at + shown.length };
  }
  return null;
}

// ---------- People ----------

/** The on-call clinician for a patient's country (fictional staff). */
export function clinicianForCountry(staff: readonly StaffMember[], country: Country): StaffMember | undefined {
  return staff.find((s) => s.role === "clinician" && s.country === country) ?? staff.find((s) => s.role === "clinician");
}

/** "Marco" from "Marco Bellini", "Anika" from "Dr Anika Rao". */
export function firstNameOf(name: string): string {
  return name.replace(/^Dr\.?\s+/, "").split(/\s+/)[0] ?? name;
}

// ---------- Patient record words ----------

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  script_pending: "Script pending",
  dispensing: "Dispensing",
  shipped: "Shipped",
  delivered: "Delivered",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

const OPEN_ORDER: OrderStatus[] = ["script_pending", "dispensing", "shipped", "on_hold"];

/** The order the patient is most likely asking about: the newest one still in progress, else the newest one. */
export function currentOrder(patient: CasePatient) {
  const open = patient.orders.find((o) => OPEN_ORDER.includes(o.status));
  return { order: open ?? patient.orders[0], inProgress: Boolean(open) };
}

/** The next booked appointment, soonest first. */
export function nextAppointment(patient: CasePatient, nowMs: number) {
  return patient.appointments
    .filter((a) => a.status === "booked" && Date.parse(a.at) >= nowMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
}

export const APPOINTMENT_KIND_LABEL = { initial: "Initial consult", follow_up: "Follow-up consult", renewal: "Renewal consult" } as const;
