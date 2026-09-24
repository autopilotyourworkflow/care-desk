/**
 * The demo's session state as pure functions: what each person did to each message, with an undo for the last action.
 * lib/client/session.tsx wraps this reducer in a React context with localStorage persistence. No React, no DOM here,
 * so it runs in tests and on the server.
 * Everything recorded here is fictional demo activity that stays in the visitor's own browser.
 */

import type { Role } from "@/components/shell/roles";

export type { Role };

/** What an agent did with a message on the desk. `by` is a staff id from data/staff.json; `at` is an ISO time. */
export type Decision =
  /** The checked draft was sent as it was (placeholders filled). */
  | { kind: "sent"; at: string; by: string; text: string }
  /** Sent after the agent changed it. `original` is the draft as shown (placeholders filled), "" for a reply written from scratch. */
  | { kind: "sent_edited"; at: string; by: string; text: string; original: string; edit: EditSize }
  /** Passed to the clinician queue by the agent. */
  | { kind: "escalated"; at: string; by: string; reason?: string }
  /** Handed to another person, who writes the reply. */
  | { kind: "reassigned"; at: string; by: string; to: string; note?: string };

export type DecisionKind = Decision["kind"];

/** How much an agent changed a draft before sending, for the "sent as is / lightly edited / rewritten" split. */
export type EditSize = "as_is" | "light" | "rewritten" | "written";

export interface TimedEntry {
  at: string;
  by: string;
}

/** A clinician's actions on one escalated message. */
export interface ClinicianRecord {
  /** Calls to the patient, oldest first. */
  calls: (TimedEntry & { outcome?: string })[];
  /** Replies the clinician wrote and sent (no AI), oldest first. */
  replies: (TimedEntry & { text: string })[];
  /** The patient's orders were released. A note is required. */
  holdResumed?: TimedEntry & { note: string };
  /** Internal notes, oldest first. */
  notes: (TimedEntry & { text: string })[];
  /**
   * The clinician found the alert was a false alarm (a figure of speech, or a death that was not the patient's). It
   * clears the bereavement reading and any alert that was only that. When the message also carries another safety
   * reading (MSG-0172: a brother's death and taking more oil than prescribed), that reading stays, so the patient's
   * replies move from withdrawn to "Check with clinician before sending". A note is required.
   */
  cleared?: TimedEntry & { note: string };
}

/** The part of the session that is saved. */
export interface SessionData {
  v: 1;
  decisions: Record<string, Decision>;
  clinician: Record<string, ClinicianRecord>;
  /** The signed-in person chosen for each role (staff id). Unset = the role's default person. */
  staffByRole: Partial<Record<Role, string>>;
}

export type UndoableType =
  | "send"
  | "sendEdited"
  | "escalate"
  | "reassign"
  | "call"
  | "reply"
  | "resumeHold"
  | "note"
  | "clear"
  | "reset";

export interface UndoEntry {
  type: UndoableType;
  /** The message acted on (absent for reset). */
  messageId?: string;
  /** Plain words for the toast, e.g. "Reply sent". */
  label: string;
  at: string;
  /** The saved data before this action. */
  before: SessionData;
}

export interface SessionState {
  data: SessionData;
  /** Most recent last. Kept in memory only (a reload starts a fresh undo history). */
  undo: UndoEntry[];
}

export const UNDO_LIMIT = 20;

export type SessionAction =
  | { type: "send"; messageId: string; at: string; by: string; text: string }
  | { type: "sendEdited"; messageId: string; at: string; by: string; text: string; original: string }
  | { type: "escalate"; messageId: string; at: string; by: string; reason?: string }
  | { type: "reassign"; messageId: string; at: string; by: string; to: string; note?: string; toName?: string }
  | { type: "call"; messageId: string; at: string; by: string; outcome?: string }
  | { type: "reply"; messageId: string; at: string; by: string; text: string }
  | { type: "resumeHold"; messageId: string; at: string; by: string; note: string }
  | { type: "note"; messageId: string; at: string; by: string; text: string }
  | { type: "clear"; messageId: string; at: string; by: string; note: string }
  | { type: "setStaff"; role: Role; staffId: string }
  | { type: "undo" }
  | { type: "reset"; at: string }
  | { type: "hydrate"; data: SessionData };

export function emptyData(): SessionData {
  return { v: 1, decisions: {}, clinician: {}, staffByRole: {} };
}

export function initialState(data: SessionData = emptyData()): SessionState {
  return { data, undo: [] };
}

export function emptyClinicianRecord(): ClinicianRecord {
  return { calls: [], replies: [], notes: [] };
}

const clean = (s: string | undefined) => (s ?? "").trim();

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word-level edit distance, bounded so a very long reply never blocks the UI. */
function wordDistance(a: string[], b: string[]): number {
  const A = a.slice(0, 600);
  const B = b.slice(0, 600);
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length] + Math.abs(a.length - A.length) + Math.abs(b.length - B.length);
}

/**
 * How much a draft changed: "as_is" (same words), "light" (up to 30% of words changed), "rewritten" (more), or
 * "written" (there was no draft to start from).
 */
export function classifyEdit(original: string, edited: string): EditSize {
  const a = words(original);
  const b = words(edited);
  if (!a.length) return "written";
  const d = wordDistance(a, b);
  if (d === 0) return "as_is";
  return d / Math.max(a.length, b.length) <= 0.3 ? "light" : "rewritten";
}

function withUndo(state: SessionState, entry: Omit<UndoEntry, "before">, data: SessionData): SessionState {
  const undo = [...state.undo, { ...entry, before: state.data }].slice(-UNDO_LIMIT);
  return { data, undo };
}

function clinicianRecord(data: SessionData, id: string): ClinicianRecord {
  return data.clinician[id] ?? emptyClinicianRecord();
}

function setClinician(data: SessionData, id: string, rec: ClinicianRecord): SessionData {
  return { ...data, clinician: { ...data.clinician, [id]: rec } };
}

function setDecision(data: SessionData, id: string, d: Decision): SessionData {
  return { ...data, decisions: { ...data.decisions, [id]: d } };
}

/** True when the data holds nothing a reset would change. */
export function isPristine(data: SessionData): boolean {
  return !Object.keys(data.decisions).length && !Object.keys(data.clinician).length && !Object.keys(data.staffByRole).length;
}

/**
 * The reducer. Invalid actions (an empty reply, a hold resumed without a note, a second decision on a message that
 * already has one) return the SAME state object, so callers can tell nothing happened.
 */
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  const { data } = state;
  switch (action.type) {
    case "send": {
      const text = clean(action.text);
      if (!text || data.decisions[action.messageId]) return state;
      return withUndo(
        state,
        { type: "send", messageId: action.messageId, label: "Reply sent", at: action.at },
        setDecision(data, action.messageId, { kind: "sent", at: action.at, by: action.by, text }),
      );
    }
    case "sendEdited": {
      const text = clean(action.text);
      if (!text || data.decisions[action.messageId]) return state;
      const original = clean(action.original);
      const edit = classifyEdit(original, text);
      return withUndo(
        state,
        { type: "sendEdited", messageId: action.messageId, label: original ? "Edited reply sent" : "Reply sent", at: action.at },
        setDecision(data, action.messageId, { kind: "sent_edited", at: action.at, by: action.by, text, original, edit }),
      );
    }
    case "escalate": {
      if (data.decisions[action.messageId]) return state;
      const reason = clean(action.reason);
      const d: Decision = { kind: "escalated", at: action.at, by: action.by };
      if (reason) d.reason = reason;
      return withUndo(
        state,
        { type: "escalate", messageId: action.messageId, label: "Escalated to a clinician", at: action.at },
        setDecision(data, action.messageId, d),
      );
    }
    case "reassign": {
      const to = clean(action.to);
      if (!to || to === action.by || data.decisions[action.messageId]) return state;
      const note = clean(action.note);
      const d: Decision = { kind: "reassigned", at: action.at, by: action.by, to };
      if (note) d.note = note;
      const who = clean(action.toName);
      return withUndo(
        state,
        { type: "reassign", messageId: action.messageId, label: who ? `Reassigned to ${who}` : "Reassigned", at: action.at },
        setDecision(data, action.messageId, d),
      );
    }
    case "call": {
      const rec = clinicianRecord(data, action.messageId);
      const outcome = clean(action.outcome);
      const entry = outcome ? { at: action.at, by: action.by, outcome } : { at: action.at, by: action.by };
      return withUndo(
        state,
        { type: "call", messageId: action.messageId, label: "Call logged", at: action.at },
        setClinician(data, action.messageId, { ...rec, calls: [...rec.calls, entry] }),
      );
    }
    case "reply": {
      const text = clean(action.text);
      if (!text) return state;
      const rec = clinicianRecord(data, action.messageId);
      return withUndo(
        state,
        { type: "reply", messageId: action.messageId, label: "Reply sent", at: action.at },
        setClinician(data, action.messageId, { ...rec, replies: [...rec.replies, { at: action.at, by: action.by, text }] }),
      );
    }
    case "resumeHold": {
      const note = clean(action.note);
      const rec = clinicianRecord(data, action.messageId);
      if (!note || rec.holdResumed) return state;
      return withUndo(
        state,
        { type: "resumeHold", messageId: action.messageId, label: "Orders resumed", at: action.at },
        setClinician(data, action.messageId, { ...rec, holdResumed: { at: action.at, by: action.by, note } }),
      );
    }
    case "note": {
      const text = clean(action.text);
      if (!text) return state;
      const rec = clinicianRecord(data, action.messageId);
      return withUndo(
        state,
        { type: "note", messageId: action.messageId, label: "Note added", at: action.at },
        setClinician(data, action.messageId, { ...rec, notes: [...rec.notes, { at: action.at, by: action.by, text }] }),
      );
    }
    case "clear": {
      const note = clean(action.note);
      const rec = clinicianRecord(data, action.messageId);
      if (!note || rec.cleared) return state;
      return withUndo(
        state,
        { type: "clear", messageId: action.messageId, label: "Marked as a false alarm", at: action.at },
        setClinician(data, action.messageId, { ...rec, cleared: { at: action.at, by: action.by, note } }),
      );
    }
    case "setStaff": {
      if (data.staffByRole[action.role] === action.staffId) return state;
      // Not undoable: it is a view setting, not an action on a message.
      return { ...state, data: { ...data, staffByRole: { ...data.staffByRole, [action.role]: action.staffId } } };
    }
    case "undo": {
      const last = state.undo[state.undo.length - 1];
      if (!last) return state;
      return { data: last.before, undo: state.undo.slice(0, -1) };
    }
    case "reset": {
      if (isPristine(data)) return state.undo.length ? { data, undo: [] } : state;
      return withUndo(state, { type: "reset", label: "Demo reset", at: action.at }, emptyData());
    }
    case "hydrate":
      return { data: action.data, undo: [] };
    default:
      return state;
  }
}

// ---------- Persistence (parsing only; storage access lives in session.tsx) ----------

export const SESSION_STORAGE_KEY = "caredesk.session.v1";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function validDecision(v: unknown): v is Decision {
  if (!isObj(v) || !isStr(v.at) || !isStr(v.by)) return false;
  switch (v.kind) {
    case "sent":
      return isStr(v.text);
    case "sent_edited":
      return isStr(v.text) && isStr(v.original) && isStr(v.edit);
    case "escalated":
      return v.reason === undefined || isStr(v.reason);
    case "reassigned":
      return isStr(v.to);
    default:
      return false;
  }
}

function validEntries(v: unknown, field?: string): boolean {
  return Array.isArray(v) && v.every((e) => isObj(e) && isStr(e.at) && isStr(e.by) && (!field || isStr(e[field])));
}

function validClinician(v: unknown): v is ClinicianRecord {
  if (!isObj(v)) return false;
  if (!validEntries(v.calls) || !validEntries(v.replies, "text") || !validEntries(v.notes, "text")) return false;
  for (const k of ["holdResumed", "cleared"] as const) {
    const e = v[k];
    if (e !== undefined && !(isObj(e) && isStr(e.at) && isStr(e.by) && isStr(e.note))) return false;
  }
  return true;
}

/** Reads saved JSON back into SessionData, dropping anything malformed. Never throws. */
export function parseSessionData(raw: string | null | undefined): SessionData {
  const out = emptyData();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isObj(parsed) || parsed.v !== 1) return out;
  if (isObj(parsed.decisions)) {
    for (const [id, d] of Object.entries(parsed.decisions)) if (validDecision(d)) out.decisions[id] = d;
  }
  if (isObj(parsed.clinician)) {
    for (const [id, c] of Object.entries(parsed.clinician)) if (validClinician(c)) out.clinician[id] = c;
  }
  if (isObj(parsed.staffByRole)) {
    for (const r of ["agent", "clinician", "lead"] as const) {
      const s = parsed.staffByRole[r];
      if (isStr(s)) out.staffByRole[r] = s;
    }
  }
  return out;
}

export function serializeSessionData(data: SessionData): string {
  return JSON.stringify(data);
}

/** Message ids a clinician has cleared as false alarms, for deriveQueue. */
export function clearedIds(data: SessionData): string[] {
  return Object.keys(data.clinician)
    .filter((id) => data.clinician[id]?.cleared)
    .sort();
}

// ---------- Calls ----------

/** The outcome saved with a call. Only a call where the clinician spoke to the patient counts as being in touch. */
export const CALL_SPOKE = "Spoke to the patient";
export const CALL_NO_ANSWER = "No answer or voicemail";

/**
 * A call that reached the patient (or the family). A missed call or voicemail does not. Calls saved before outcomes
 * existed count as reached, as they always did. The one rule for both screens: the desk's locks (contactedIds) and the
 * clinician queue's "handled" state.
 */
export function callReachedPatient(outcome: string | undefined): boolean {
  return outcome !== CALL_NO_ANSWER;
}

/**
 * Message ids whose clinician has been in touch with the patient (a call that reached them, or a reply sent), for
 * deriveQueue. That lifts the "Check with clinician before sending" locks the message put on the patient's other
 * replies. A call with no answer keeps them held.
 */
export function contactedIds(data: SessionData): string[] {
  return Object.keys(data.clinician)
    .filter((id) => {
      const rec = data.clinician[id];
      return Boolean(rec && (rec.calls.some((c) => callReachedPatient(c.outcome)) || rec.replies.length > 0));
    })
    .sort();
}
