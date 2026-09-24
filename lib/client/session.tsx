"use client";

/**
 * The demo session, shared by every page: decisions on the desk, clinician actions, undo, the "Viewing as" role, the
 * signed-in staff member and "Reset the demo". Mounted once in app/layout.tsx.
 *
 * Saved in localStorage under caredesk.session.v1, wrapped in try/catch: with storage blocked (private windows, some
 * previews) everything still works for the visit and is simply not remembered. The first render uses empty state on
 * the server and in the browser alike, then the saved state loads in an effect (`ready` turns true), so static pages
 * never mismatch.
 * Everything recorded is fictional demo activity that never leaves the visitor's browser.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import staffData from "@/data/staff.json";
import { ROLES, roleForPath, setRole as setStoredRole, useRole, type Role } from "@/components/shell/roles";
import {
  SESSION_STORAGE_KEY,
  emptyClinicianRecord,
  emptyData,
  initialState,
  isPristine,
  parseSessionData,
  serializeSessionData,
  sessionReducer,
  type ClinicianRecord,
  type Decision,
  type SessionAction,
  type SessionData,
  type UndoEntry,
} from "./session-state";
import type { QueueFile, StaffMember } from "./types";
import { applySession, canSendReply, type DeskRow } from "./queue";
import { peekData, useQueue, type DataError, type ResourceStatus } from "./data";

export const STAFF: readonly StaffMember[] = staffData as StaffMember[];
const STAFF_BY_ID = new Map(STAFF.map((s) => [s.id, s]));

/** Fired on window after resetDemo(), so other modules (the tour, a live box) can drop their own in-memory state. */
export const RESET_EVENT = "caredesk:reset-demo";

/** The default signed-in person for a role: the name in components/shell/roles.ts, matched in data/staff.json. */
export function defaultStaffFor(role: Role): StaffMember {
  const name = ROLES[role].user.name;
  const found = STAFF.find((s) => s.name === name && s.role === role) ?? STAFF.find((s) => s.role === role);
  if (found) return found;
  return { id: `default-${role}`, name, role, country: "AU", title: ROLES[role].user.title };
}

export function staffForRole(data: SessionData, role: Role): StaffMember {
  const chosen = data.staffByRole[role];
  const s = chosen ? STAFF_BY_ID.get(chosen) : undefined;
  return s && s.role === role ? s : defaultStaffFor(role);
}

export function staffName(id: string | undefined): string | undefined {
  return id ? STAFF_BY_ID.get(id)?.name : undefined;
}

export interface SessionApi {
  /** True once saved state has been read (or storage turned out to be blocked). */
  ready: boolean;
  data: SessionData;
  /** The "Viewing as" role: the area being viewed, else the saved choice. */
  role: Role;
  /** Switch the role (does not navigate; AppShell's switchRole also goes to the role's home). */
  setRole: (role: Role) => void;
  /** The signed-in staff member for the current role. Fill [AGENT_NAME] with staff.name. */
  staff: StaffMember;
  staffFor: (role: Role) => StaffMember;
  /** Every fictional staff member (data/staff.json). */
  staffList: readonly StaffMember[];
  /** Choose who is signed in for a role. Ignored when the staff member does not hold that role. */
  setStaff: (role: Role, staffId: string) => void;

  decisionFor: (messageId: string) => Decision | undefined;
  clinicianFor: (messageId: string) => ClinicianRecord;
  /** Message ids a clinician marked as false alarms. */
  cleared: string[];

  // Agent decisions. Each returns false when nothing changed (empty text, or the message already has a decision).
  /** Send the checked draft as is. `text` is the draft with placeholders filled. */
  send: (messageId: string, text: string) => boolean;
  /** Send after editing. `original` is the draft as shown (placeholders filled), "" for a reply written from scratch. */
  sendEdited: (messageId: string, text: string, original: string) => boolean;
  escalate: (messageId: string, reason?: string) => boolean;
  /** Hand to another staff member. Not to yourself. */
  reassign: (messageId: string, toStaffId: string, note?: string) => boolean;

  // Clinician actions. Each returns false when nothing changed (a required note or text was empty).
  logCall: (messageId: string, outcome?: string) => boolean;
  clinicianReply: (messageId: string, text: string) => boolean;
  /** Release the orders on hold. The note is required. */
  resumeHold: (messageId: string, note: string) => boolean;
  addNote: (messageId: string, text: string) => boolean;
  /** Mark the alert a false alarm (for example a death reported about a relative). Releases the patient's other drafts. */
  clearAlert: (messageId: string, note: string) => boolean;

  /** The action Undo would reverse (most recent), or null. */
  lastAction: Omit<UndoEntry, "before"> | null;
  canUndo: boolean;
  /** Reverse the last action. Returns what was undone, or null. */
  undo: () => Omit<UndoEntry, "before"> | null;
  /**
   * Back to the start: every message in the queue again, the role back to Agent, default staff, and any other
   * caredesk.* keys cleared (the Insights assumptions, the desk's filter and sort). Fires RESET_EVENT on window.
   * Returns true when anything changed: decisions, actions or a remembered setting. Only the decisions and actions
   * can be undone: offer Undo when `!isPristine(data)` held before the call (see AppShell's useResetDemo).
   */
  resetDemo: () => boolean;
}

const SessionContext = createContext<SessionApi | null>(null);

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(data: SessionData) {
  try {
    const text = serializeSessionData(data);
    // Skip identical writes, so two open tabs never echo the same value back and forth.
    if (window.localStorage.getItem(SESSION_STORAGE_KEY) !== text) window.localStorage.setItem(SESSION_STORAGE_KEY, text);
  } catch {
    /* storage blocked or full: keep it in memory for this visit */
  }
}

/**
 * Keys a reset leaves alone: the private link for the live box is access, not demo state, and turning one-key
 * shortcuts off (components/shell/preferences.ts) is an accessibility need, not demo state.
 */
const KEEP_ON_RESET = new Set(["caredesk.try.key", "caredesk.singleKeys.v1"]);

/**
 * Whether a remembered value is just the default, so clearing it is not "a change" for the reset toast. The role is
 * set back to Agent anyway and the tour position is not something the visitor changed; the desk view counts only
 * when its filter or sort moved; anything else a page remembers (the Insights assumptions) is written only when the
 * visitor changes it.
 */
function isDefaultValue(key: string, raw: string | null): boolean {
  if (raw === null) return true;
  if (key === "caredesk.role" || key.startsWith("caredesk.tour")) return true;
  if (key === "caredesk.desk.view") {
    try {
      const v = JSON.parse(raw) as { filter?: unknown; sort?: unknown } | null;
      return (v?.filter ?? "all") === "all" && (v?.sort ?? "priority") === "priority";
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Removes every caredesk.* key except the session itself (the tour position, remembered filters, the Insights
 * assumptions and so on). Returns true when one of them held something other than its default.
 */
function clearOtherKeys(): boolean {
  let changed = false;
  const sweep = (store: Storage, skip: (k: string) => boolean) => {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith("caredesk.") && !skip(k) && !KEEP_ON_RESET.has(k)) keys.push(k);
    }
    for (const k of keys) {
      if (!isDefaultValue(k, store.getItem(k))) changed = true;
      store.removeItem(k);
    }
  };
  try {
    sweep(window.localStorage, (k) => k === SESSION_STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
  try {
    sweep(window.sessionStorage, () => false);
  } catch {
    /* storage blocked */
  }
  return changed;
}

const now = () => new Date().toISOString();

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, undefined, () => initialState());
  const [ready, markReady] = useReducer(() => true, false);
  // The latest state, kept ahead of renders so each action can report whether it changed anything.
  const stateRef = useRef(state);

  const pathname = usePathname() ?? "/";
  const [storedRole] = useRole();
  const role = roleForPath(pathname) ?? storedRole;

  /** Every change goes through here: runs the reducer once to see if anything changes, then dispatches it. */
  const run = useCallback((action: SessionAction): boolean => {
    const before = stateRef.current;
    const after = sessionReducer(before, action);
    if (after === before) return false;
    stateRef.current = after;
    dispatch(action);
    return true;
  }, []);

  // Load saved state once, after the first render. `ready` flips in the same render as the loaded data.
  useEffect(() => {
    run({ type: "hydrate", data: parseSessionData(readStorage()) });
    markReady();
  }, [run]);

  // Save after every change, once the saved state has loaded (never over it with the empty first render).
  useEffect(() => {
    if (ready) writeStorage(state.data);
  }, [ready, state.data]);

  // Another tab changed the session: take its version.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_STORAGE_KEY) return;
      run({ type: "hydrate", data: parseSessionData(e.newValue) });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [run]);

  const api = useMemo<SessionApi>(() => {
    const data = state.data;
    const staff = staffForRole(data, role);
    const by = () => staffForRole(stateRef.current.data, role).id;
    // Defence in depth: refuse a reply the queue (with this session applied) holds or blocks, whatever the screen
    // checked. Without the queue loaded there is nothing to check against, so nothing is sent.
    const sendable = (messageId: string) => {
      const items = peekData<QueueFile>("queue.json")?.items;
      return !!items && canSendReply(items, stateRef.current.data, messageId);
    };
    const last = state.undo[state.undo.length - 1];
    const strip = (u: UndoEntry | undefined) => {
      if (!u) return null;
      const { before: _before, ...rest } = u;
      void _before;
      return rest;
    };
    return {
      ready,
      data,
      role,
      setRole: (r) => setStoredRole(r),
      staff,
      staffFor: (r) => staffForRole(stateRef.current.data, r),
      staffList: STAFF,
      setStaff: (r, staffId) => {
        const s = STAFF_BY_ID.get(staffId);
        if (s && s.role === r) run({ type: "setStaff", role: r, staffId });
      },
      decisionFor: (id) => data.decisions[id],
      clinicianFor: (id) => data.clinician[id] ?? emptyClinicianRecord(),
      cleared: Object.keys(data.clinician).filter((id) => data.clinician[id]?.cleared),
      send: (messageId, text) => sendable(messageId) && run({ type: "send", messageId, text, at: now(), by: by() }),
      sendEdited: (messageId, text, original) =>
        sendable(messageId) && run({ type: "sendEdited", messageId, text, original, at: now(), by: by() }),
      escalate: (messageId, reason) => run({ type: "escalate", messageId, reason, at: now(), by: by() }),
      reassign: (messageId, to, note) =>
        run({ type: "reassign", messageId, to, note, toName: staffName(to), at: now(), by: by() }),
      logCall: (messageId, outcome) => run({ type: "call", messageId, outcome, at: now(), by: by() }),
      clinicianReply: (messageId, text) => run({ type: "reply", messageId, text, at: now(), by: by() }),
      resumeHold: (messageId, note) => run({ type: "resumeHold", messageId, note, at: now(), by: by() }),
      addNote: (messageId, text) => run({ type: "note", messageId, text, at: now(), by: by() }),
      clearAlert: (messageId, note) => run({ type: "clear", messageId, note, at: now(), by: by() }),
      lastAction: strip(last),
      canUndo: Boolean(last),
      undo: () => {
        const top = stateRef.current.undo[stateRef.current.undo.length - 1];
        if (!run({ type: "undo" })) return null;
        return strip(top);
      },
      resetDemo: () => {
        // A reset of pristine data only drops the undo history: not a change worth reporting.
        const sessionChanged = !isPristine(stateRef.current.data);
        run({ type: "reset", at: now() });
        const settingsChanged = clearOtherKeys();
        setStoredRole("agent");
        try {
          window.dispatchEvent(new CustomEvent(RESET_EVENT));
        } catch {
          /* no window events: nothing else to tell */
        }
        return sessionChanged || settingsChanged;
      },
    };
  }, [state, role, ready, run]);

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

const FALLBACK_DATA = emptyData();

/** The shared demo session. Outside the provider it returns a read-only empty session, so components never crash. */
export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (ctx) return ctx;
  const role: Role = "agent";
  return {
    ready: false,
    data: FALLBACK_DATA,
    role,
    setRole: setStoredRole,
    staff: defaultStaffFor(role),
    staffFor: defaultStaffFor,
    staffList: STAFF,
    setStaff: () => {},
    decisionFor: () => undefined,
    clinicianFor: () => emptyClinicianRecord(),
    cleared: [],
    send: () => false,
    sendEdited: () => false,
    escalate: () => false,
    reassign: () => false,
    logCall: () => false,
    clinicianReply: () => false,
    resumeHold: () => false,
    addNote: () => false,
    clearAlert: () => false,
    lastAction: null,
    canUndo: false,
    undo: () => null,
    resetDemo: () => false,
  };
}

export interface DeskQueue {
  status: ResourceStatus;
  /** Every desk row with this session applied, in display order. Empty while loading. */
  rows: DeskRow[];
  error: DataError | undefined;
  retry: () => void;
  /** Saved session state has loaded (decisions shown are final). */
  sessionReady: boolean;
}

/**
 * queue.json with this session's decisions, clinician actions and cleared alerts applied. Filter with openDeskRows()
 * for the desk and clinicianRows() for the clinician queue (lib/client/queue.ts).
 */
export function useDeskQueue(): DeskQueue {
  const q = useQueue();
  const session = useSession();
  const items = q.data?.items;
  const rows = useMemo(() => (items ? applySession(items, session.data) : []), [items, session.data]);
  return { status: q.status, rows, error: q.error, retry: q.retry, sessionReady: session.ready };
}
