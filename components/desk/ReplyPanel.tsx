"use client";

import {
  Fragment,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from "react";
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  CornerUpRight,
  Ellipsis,
  FlaskConical,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Send,
  Stethoscope,
  Undo2,
  UserRoundCheck,
  UserRoundPlus,
} from "lucide-react";
import type { CheckResult, PipelineResult, SourceRef, StepId } from "@/lib/types";
import type { CaseFile, StaffMember } from "@/lib/client/types";
import type { DeskRow, ReplyPermission } from "@/lib/client/queue";
import type { QueueLock } from "@/lib/fixtures/queue";
import type { Decision } from "@/lib/client/session-state";
import { staffName } from "@/lib/client/session";
import { COUNTRY_LABEL, fillDraftPlaceholders, formatMs, formatPercent } from "@/lib/format";
import { createPortal } from "react-dom";
import { StatusIcon, Trail, verdictText } from "@/components/trail";
import {
  STEP_ORDER,
  displayStateFor,
  normalizeTrail,
  stopIndex,
  useReveal,
  type DisplayState,
} from "@/components/trail/reveal";
import {
  Button,
  Card,
  Field,
  HoldBadge,
  KeyCombo,
  Menu,
  RiskBadge,
  Select,
  Skeleton,
  TextArea,
  Tooltip,
  cn,
} from "@/components/ui";
import { LoadingStatus } from "@/components/ui/Skeleton";
import { getTourSnapshot, subscribeTour } from "@/components/tour/state";
import { TOUR_STOPS } from "@/components/tour/steps";
import {
  banHelp,
  checkEdit,
  clinicianForCountry,
  decideView,
  firstNameOf,
  placeholderBlockReason,
  rewriteSpan,
  sendBlockReason,
  starterCaret,
  starterReply,
  stripCitations,
} from "./desk-model";
import { CheckFirstNote, DraftView, LiveCheck, checkProblems } from "./DraftBlock";
import { StatusBadge, rowBadge } from "./StatusBadge";

export interface ReplyPanelHandle {
  /** E: edit the draft, or start writing the reply. */
  edit: () => boolean;
  /** Ctrl+Enter: send what is on screen. Returns false when nothing can be sent. */
  send: () => boolean;
  /** X: open the escalate step (or confirm it when it is already open). */
  escalate: () => boolean;
  /** True while a text box of this panel has focus or an edit is open. */
  busy: () => boolean;
}

export interface ReplyPanelProps {
  data: CaseFile;
  row?: DeskRow;
  permission: ReplyPermission;
  staff: StaffMember;
  staffList: readonly StaffMember[];
  /** The message this session last acted on: Undo is offered on its record. */
  undoableId?: string | null;
  onSend: (text: string) => void;
  onSendEdited: (text: string, original: string) => void;
  onEscalate: (reason?: string) => void;
  onReassign: (to: string, note?: string) => void;
  onUndo: () => void;
  /**
   * The session accepts a reply on a message that was passed to a colleague (a hand-over, not a final decision).
   * When false, a passed message shows only its record.
   */
  handoverOpen?: boolean;
  handleRef?: Ref<ReplyPanelHandle>;
  /**
   * A reply the agent sent and then undid: it comes back in the editor, word for word, so an edit is never lost to
   * Undo. Pass a new object for each undo; onRestored is called once it has been taken up.
   */
  restore?: RestoreReply | null;
  onRestored?: () => void;
  /**
   * Where the check trail goes while the details are open: the details column beside the conversation on wide
   * screens, the details under the reply on narrower ones. Without it the trail is kept out of view (it still runs
   * its checks, so the reply's "Running the checks" state is real), and the reply leads on its own.
   */
  detailsSlot?: HTMLElement | null;
}

/** The text of an undone reply, and the draft it was edited from ("" for a reply written from scratch). */
export interface RestoreReply {
  text: string;
  original: string;
}

type Mode = "idle" | "edit" | "escalate" | "reassign";
type Origin = "draft" | "blocked" | "scratch";

/**
 * Scrolls the reply column (not the page) just enough to show `el`, with `pad` px to spare. On phones, where the
 * column does not scroll, the page scrolls instead. Used when an edit or an escalate note opens.
 */
function revealInColumn(el: HTMLElement | null, pad = 16) {
  if (!el) return;
  const col = el.closest<HTMLElement>("[data-desk-reply]");
  const scrolls = col && col.scrollHeight > col.clientHeight + 1;
  // Keep clear of the sticky bars too: their heights are reserved as scroll padding (see trackBarClearance).
  const root = document.documentElement;
  const box = scrolls
    ? (() => {
        const b = col.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom - px(col.style.scrollPaddingBottom) };
      })()
    : { top: Math.max(64, px(root.style.scrollPaddingTop)), bottom: window.innerHeight - px(root.style.scrollPaddingBottom) };
  const r = el.getBoundingClientRect();
  let delta = 0;
  if (r.bottom + pad > box.bottom) delta = Math.min(r.bottom + pad - box.bottom, r.top - box.top - pad);
  else if (r.top - pad < box.top) delta = r.top - pad - box.top;
  if (!delta) return;
  if (scrolls) col.scrollTop += delta;
  else window.scrollBy({ top: delta });
}

function px(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

const WIDE_QUERY = "(min-width: 1024px)";

/**
 * The sticky Send / Edit / Escalate bar must never cover the control that has keyboard focus (WCAG 2.4.11). While the
 * bar is on screen, its height (plus a little air) is reserved as scroll padding on what scrolls behind it: the reply
 * column on wide screens, the page on phones and at high zoom. Focusing a source button or citation under the bar then
 * scrolls it clear. A callback ref with a cleanup (React 19), so the padding follows whichever bar is shown and goes
 * with it.
 */
function trackBarClearance(bar: HTMLDivElement | null): (() => void) | undefined {
  if (!bar) return undefined;
  const col = bar.closest<HTMLElement>("[data-desk-reply]");
  const root = document.documentElement;
  let mq: MediaQueryList | null = null;
  try {
    mq = window.matchMedia(WIDE_QUERY);
  } catch {
    mq = null;
  }
  const apply = () => {
    const h = `${Math.ceil(bar.getBoundingClientRect().height) + 8}px`;
    const wide = mq ? mq.matches : true;
    if (col) col.style.scrollPaddingBottom = wide ? h : "";
    root.style.scrollPaddingBottom = wide ? "" : h;
  };
  apply();
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
  ro?.observe(bar);
  mq?.addEventListener("change", apply);
  return () => {
    ro?.disconnect();
    mq?.removeEventListener("change", apply);
    if (col) col.style.scrollPaddingBottom = "";
    root.style.scrollPaddingBottom = "";
  };
}

/** Trails already revealed in this visit: each ticket ticks through its checks only the first time it opens. */
const seenTrails = new Set<string>();

const EDIT_WORDS: Record<string, string> = {
  as_is: "as drafted",
  light: "with light edits",
  rewritten: "after a rewrite",
  written: "written by hand",
};

/** What a person did with the message, in one line: "Sent to Olivia by you, as drafted". */
function decisionSummary(decision: Decision, firstName: string, meId: string): string {
  const who = decision.by === meId ? "you" : (staffName(decision.by) ?? "a colleague");
  switch (decision.kind) {
    case "sent":
      return `Sent to ${firstName} by ${who}, as drafted`;
    case "sent_edited":
      return `Sent to ${firstName} by ${who}, ${EDIT_WORDS[decision.edit] ?? "edited"}`;
    case "escalated":
      return `Escalated to a clinician by ${who}. Nothing was sent`;
    case "reassigned":
      return `Passed to ${staffName(decision.to) ?? "a colleague"} by ${who}`;
  }
}

/** The decide step on a locked row: short, because the banner beside the message explains the lock in full. */
function lockSummary(lock: QueueLock): string {
  return lock.kind === "withdrawn" ? "Send is off. Nothing is sent to this patient" : "Send is off for now";
}

/** The verdict line for a locked row: the patient-level lock outranks this message's own result. */
function lockVerdict(lock: QueueLock): string {
  return lock.kind === "withdrawn"
    ? `A death was reported in ${lock.messageId}, so nothing is sent to this patient.`
    : `Held until a clinician has been in touch about ${lock.messageId}.`;
}

type Placement = "send" | "write" | "other" | null;

/**
 * The trail as it stands in this session. Once a person has decided, the last step is done and says what happened.
 * On a locked row the decide step says Send is off (never "waiting to send"). The reply sits under the steps, so the
 * decide step points down to it.
 */
function forDisplay(
  result: PipelineResult,
  decision: Decision | undefined,
  lock: QueueLock | undefined,
  placement: Placement,
  firstName: string,
  meId: string,
): PipelineResult {
  let summary: string | undefined;
  let passed = false;
  if (decision) {
    summary = decisionSummary(decision, firstName, meId);
    passed = true;
  } else if (lock) summary = lockSummary(lock);
  else if (placement === "send") summary = "Waiting for you to send, edit or escalate the draft";
  else if (placement === "write") summary = "Waiting for you to write the reply, escalate it or pass it on";
  return {
    ...result,
    trail: summary
      ? result.trail.map((s) =>
          s.id === "decide"
            ? {
                ...s,
                summary: summary!,
                status: passed ? ("passed" as const) : s.status,
              }
            : s,
        )
      : result.trail,
  };
}

const EXPANDABLE_STEPS: StepId[] = ["redact", "rules", "sort", "sources", "draft", "check"];

/** The built-in stand-in for Claude played the AI's part (sample results): there is no real AI cost to show. */
function usedStandIn(result: PipelineResult): boolean {
  return [result.models.sort, result.models.draft].some((m) => typeof m === "string" && m.startsWith("mock"));
}

/** Why a person, not the AI, writes this reply: one plain sentence. */
function whyPerson(result: PipelineResult): string {
  if (result.draft?.declined) return `The AI declined to draft: ${result.draft.declined}`;
  if (result.check && !result.check.passed)
    return "The fact check blocked the AI draft, so it cannot be sent as written.";
  const s = result.sort;
  if (s?.category === "wants_human") return "They asked for a person, so a person replies. There is no AI draft.";
  if (s?.category === "complaint") return "Complaints always get a reply written by a person.";
  if (s?.category === "privacy_request") return "Privacy requests are answered by a person, never drafted by the AI.";
  if (s && s.confidence < 0.75)
    return `The sorter was only ${formatPercent(s.confidence)} sure what this is, below the 75% bar, so a person replies.`;
  if (result.mode === "deterministic_only" && !s) return "The AI was resting, so a person writes this reply.";
  return "No AI draft for this one. A person writes the reply.";
}

export function ReplyPanel({
  data,
  row,
  permission,
  staff,
  staffList,
  undoableId,
  onSend,
  onSendEdited,
  onEscalate,
  onReassign,
  onUndo,
  handoverOpen = false,
  handleRef,
  restore,
  onRestored,
  detailsSlot = null,
}: ReplyPanelProps) {
  const id = data.messageId;
  const result = data.result;
  const firstName = data.patient.firstName;
  const agentName = staff.name;
  const decision = row?.decision;
  // Passed to a colleague is a hand-over, not a final decision: the reply can still be written and sent here.
  const handover = decision?.kind === "reassigned" && handoverOpen ? decision : undefined;
  const final = handover ? undefined : decision;
  const isEmail = data.message.channel === "email";
  const sources: SourceRef[] = useMemo(
    () => [...(result.sources?.records ?? []), ...(result.sources?.policy ?? [])],
    [result.sources],
  );
  const draft = result.draft?.text && !result.draft.declined ? result.draft : undefined;
  const shownDraft = draft ? stripCitations(fillDraftPlaceholders(draft.text, firstName, agentName)) : "";
  const blockedDraft = Boolean(draft && result.check && !result.check.passed);
  // A checked draft that still holds a placeholder (a blank name, or a hidden detail's stand-in) never goes as written.
  const draftHold = shownDraft ? placeholderBlockReason(shownDraft) : null;
  const safety = row
    ? row.status === "clinician" || row.status === "urgent"
    : result.route === "clinician" || result.route === "urgent";
  const lock = row?.lock;
  const canEscalate = !final && !safety && !data.testOnly && row?.status !== "withdrawn";
  // Why nothing may go to the patient right now (null when a reply may). Worked out on every render from the live row,
  // so a lock or hold that arrives mid-edit switches Send off at once; every send checks it again.
  const sendOff = sendBlockReason({ permission, lock, decided: Boolean(final) });
  const canWrite = (permission === "send_draft" || permission === "write_reply") && !sendOff;

  // ---------- Reveal ----------
  const [animate] = useState(() => !seenTrails.has(id));
  const [revealed, setRevealed] = useState(!animate);
  useEffect(() => {
    seenTrails.add(id);
  }, [id]);

  // ---------- Modes ----------
  const [mode, setMode] = useState<Mode>("idle");
  const [origin, setOrigin] = useState<Origin>("draft");
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [checked, setChecked] = useState<{
    text: string;
    result: CheckResult;
  } | null>(null);
  const [ack, setAck] = useState(false);
  /**
   * An edit that Send was switched off under (a lock or hold arrived while the agent was typing). The text is kept, so
   * nothing is lost: it is shown read-only beside the reason, and comes back in the editor once Send is back on.
   */
  const [kept, setKept] = useState<{ origin: Origin; text: string; original: string } | null>(null);
  const [note, setNote] = useState("");
  const others = staffList.filter((s) => s.role === "agent" && s.id !== staff.id);
  const [assignee, setAssignee] = useState(others[0]?.id ?? "");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** The button that opened the current step (data-return value), so Cancel and Esc can put focus back on it. */
  const returnTo = useRef<string | null>(null);

  const openStep = (m: "escalate" | "reassign") => {
    returnTo.current = m === "escalate" ? "escalate" : "pass";
    setMode(m);
  };

  // A lock or hold arrived while the editor was open: leave the edit at once (during render, so no frame ever shows an
  // active Send beside the lock), keeping what was typed.
  if (mode === "edit" && sendOff) {
    setKept({ origin, text, original });
    setMode("idle");
  }

  const startEdit = (from: Origin) => {
    if (sendOff) return;
    returnTo.current = from === "draft" ? "edit" : from === "blocked" ? "fix" : blockedDraft ? "scratch" : "write";
    // An edit that was paused by a lock picks up where it left off, whichever button reopens it.
    const resume = kept;
    const start = resume ? resume.text : from === "scratch" ? starterReply(firstName, agentName) : shownDraft;
    const startOrigin = resume ? resume.origin : from;
    setOrigin(startOrigin);
    setText(start);
    setOriginal(resume ? resume.original : from === "scratch" ? "" : start);
    setChecked({ text: start, result: checkEdit(start, sources, data) });
    setAck(false);
    setKept(null);
    caret.current = !resume && from === "scratch" ? starterCaret(firstName) : start.length;
    setMode("edit");
  };

  // An undone send: the reply comes back as the agent sent it, in the editor (during render, so the draft never
  // flashes first). If Send is off by now, it is kept beside the reason instead, so it is still not lost.
  const [restored, setRestored] = useState<RestoreReply | null>(null);
  if (restore && restore !== restored && !final && mode === "idle") {
    const from: Origin = !restore.original ? "scratch" : blockedDraft ? "blocked" : "draft";
    setRestored(restore);
    if (canWrite) {
      setOrigin(from);
      setText(restore.text);
      setOriginal(restore.original);
      setChecked({ text: restore.text, result: checkEdit(restore.text, sources, data) });
      setAck(false);
      setKept(null);
      setMode("edit");
    } else {
      setKept({ origin: from, text: restore.text, original: restore.original });
    }
  }
  useEffect(() => {
    if (!restored) return;
    returnTo.current = !restored.original ? (blockedDraft ? "scratch" : "write") : blockedDraft ? "fix" : "edit";
    onRestored?.();
    // The desk resets its columns to the top when a message opens: bring the editor back into view after that.
    const raf = window.requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      revealInColumn(el.closest<HTMLElement>("[data-tour='desk-draft']") ?? el, 24);
    });
    return () => window.cancelAnimationFrame(raf);
    // Once per restore: the callback and the draft state are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // Focus the editor (or the note) when a step opens.
  useLayoutEffect(() => {
    if (mode === "edit" && editorRef.current) {
      const el = editorRef.current;
      el.focus({ preventScroll: true });
      revealInColumn(el.closest<HTMLElement>("[data-tour='desk-draft']") ?? el, 24);
      if (caret.current != null) {
        el.setSelectionRange(caret.current, caret.current);
        caret.current = null;
      }
    }
    if ((mode === "escalate" || mode === "reassign") && noteRef.current) {
      noteRef.current.focus({ preventScroll: true });
      revealInColumn(noteRef.current, 96);
    }
  }, [mode, revealed]);

  // When a lock pauses the edit, the editor that had focus is gone: the note that says why (and keeps the text) takes it.
  const keptRef = useRef<HTMLDivElement>(null);
  const hadKept = useRef(false);
  useLayoutEffect(() => {
    const now = Boolean(kept);
    if (now && !hadKept.current) {
      const active = document.activeElement;
      if (!active || active === document.body || panelRef.current?.contains(active)) {
        keptRef.current?.focus({ preventScroll: true });
        revealInColumn(keptRef.current, 24);
      }
    }
    hadKept.current = now;
  }, [kept]);

  // Live fact check: re-run a moment after the text stops changing, the way the pipeline checks a draft (with the
  // patient's redacted message, so a date or time they wrote is "check first", not missing).
  useEffect(() => {
    if (mode !== "edit") return;
    if (checked?.text === text) return;
    const t = window.setTimeout(() => {
      setChecked({ text, result: checkEdit(text, sources, data) });
    }, 280);
    return () => window.clearTimeout(t);
  }, [mode, text, checked?.text, sources, data]);

  const pending = mode === "edit" && checked?.text !== text;
  const live = checked?.result ?? null;
  const { missing, banned } = checkProblems(live);
  const strict = origin !== "scratch";

  /** Why Send is off while editing, or null when it may go. */
  const editBlock = (() => {
    if (mode !== "edit") return null;
    if (sendOff) return sendOff;
    if (!text.trim() || text.trim() === starterReply(firstName, agentName).trim()) return "Write the reply first.";
    const placeholders = placeholderBlockReason(text);
    if (placeholders) return placeholders;
    if (pending) return "Checking the facts in your reply.";
    if (banned.length) {
      // Entries read "label: matched words"; the words are already marked in the reply, so name only what kind of problem it is.
      const kinds = Array.from(new Set(banned.map((b) => b.split(": ")[0])));
      return banHelp(live)?.kind === "policy"
        ? `Rewrite the marked part (${kinds.join(", ")}).`
        : `Take out the marked part (${kinds.join(", ")}).`;
    }
    if (missing.length && strict)
      return `${missing.map((f) => `"${f.text}"`).join(", ")} ${missing.length === 1 ? "is" : "are"} not in the sources. Fix or remove ${missing.length === 1 ? "it" : "them"} to send.`;
    if (missing.length && !ack) return "Confirm you have checked the facts marked above.";
    return null;
  })();

  /** Select the blocked words a rewrite can fix, so the agent can type over them. Focus alone when they cannot be found. */
  const selectForRewrite = () => {
    const el = editorRef.current;
    if (!el) return;
    const span = rewriteSpan(text, banned);
    el.focus();
    if (span) el.setSelectionRange(span.start, span.end);
  };
  const doSendDraft = () => {
    if (sendOff || draftHold || permission !== "send_draft" || !revealed || !shownDraft) return false;
    onSend(shownDraft);
    return true;
  };
  const doSendEdited = () => {
    // The lock is checked here too, not only on the button: Ctrl+Enter and a stale click both land here.
    if (mode !== "edit" || sendOff || editBlock) return false;
    if (origin !== "scratch" && text === original) onSend(text);
    else onSendEdited(text.trim(), origin === "scratch" ? "" : original);
    return true;
  };
  const doEscalate = () => {
    if (!canEscalate) return false;
    onEscalate(note.trim() || undefined);
    return true;
  };
  const doReassign = () => {
    // A locked message cannot be passed on: the colleague could not send it either.
    if (!assignee || decision || data.testOnly || lock) return false;
    onReassign(assignee, note.trim() || undefined);
    return true;
  };
  /** Focus goes back to the button that opened the step (or the first one that opens a step), not to the page body. */
  const focusReturn = (key: string | null) => {
    window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const el =
        (key ? panel?.querySelector<HTMLElement>(`[data-return="${key}"]`) : null) ??
        panel?.querySelector<HTMLElement>("[data-return]") ??
        panel?.querySelector<HTMLElement>("h2");
      el?.focus();
    });
  };
  const cancel = () => {
    setMode("idle");
    setNote("");
    focusReturn(returnTo.current);
  };

  useImperativeHandle(handleRef, () => ({
    edit: () => {
      if (!revealed || mode === "edit" || !canWrite || sendOff) return false;
      if (permission === "send_draft") startEdit("draft");
      else startEdit(blockedDraft ? "blocked" : "scratch");
      return true;
    },
    send: () => {
      if (mode === "edit") return doSendEdited();
      if (mode === "escalate") return doEscalate();
      if (mode === "reassign") return doReassign();
      return doSendDraft();
    },
    escalate: () => {
      if (!canEscalate || !revealed) return false;
      if (mode === "escalate") return doEscalate();
      openStep("escalate");
      return true;
    },
    busy: () => mode !== "idle",
  }));

  // ---------- The check trail ----------
  const trailRef = useRef<HTMLDivElement>(null);
  const checksRef = useRef<HTMLDivElement>(null);
  const inTrail = Boolean(data.testOnly || safety);
  const placement: Placement = inTrail
    ? null
    : permission === "send_draft" && draft
      ? "send"
      : permission === "write_reply"
        ? "write"
        : "other";
  const shownResult = useMemo(
    () => forDisplay(result, final, lock, placement, firstName, staff.id),
    [result, final, lock, placement, firstName, staff.id],
  );
  /**
   * How much of the trail shows beside the reply. It opens folded to one line of seven ticks, so the reply leads;
   * "Show steps" lists them one line each, and a step opens the full trail with that step's evidence.
   */
  const [detail, setDetail] = useState<{ level: TrailLevel; open: StepId[]; n: number }>({ level: "fold", open: [], n: 0 });
  // The tour's "checks" stop talks about the seven steps, so they show while it is up.
  const tourStop = useSyncExternalStore(subscribeTour, tourStopId, () => null);
  const level: TrailLevel = detail.level === "fold" && tourStop === "checks" ? "steps" : detail.level;
  /** Where focus goes once the trail changes level: the first step, the header toggle, or a step's own toggle. */
  const focusAfter = useRef<"steps" | "toggle" | StepId | null>(null);
  const setLevel = (next: TrailLevel, open: StepId[], focus: "steps" | "toggle" | StepId) => {
    focusAfter.current = focus;
    setDetail((d) => ({ level: next, open, n: d.n + 1 }));
  };
  useLayoutEffect(() => {
    const want = focusAfter.current;
    if (!want) return;
    focusAfter.current = null;
    const root = checksRef.current;
    let el: HTMLElement | null | undefined;
    if (want === "steps")
      el = root?.querySelector<HTMLElement>("ol button") ?? root?.querySelector<HTMLElement>("[data-trail-toggle]");
    else if (want === "toggle") el = root?.querySelector<HTMLElement>("[data-trail-toggle]");
    else {
      const i = STEP_ORDER.indexOf(want);
      el = trailRef.current?.querySelector<HTMLElement>(`:scope > section > ol > li:nth-child(${i + 1}) button[aria-expanded]`);
    }
    el?.focus();
  }, [detail]);
  useEffect(() => {
    const items = trailRef.current?.querySelector("ol")?.children;
    if (!items) return;
    const stopAt = STEP_ORDER.findIndex((sid) => shownResult.trail.find((s) => s.id === sid)?.status === "stopped");
    Array.from(items).forEach((li, i) => {
      const el = li as HTMLElement;
      if (i === 3) el.dataset.tour = "desk-sources";
      else if (i === 5) el.dataset.tour = "desk-factcheck";
      else if (i === stopAt) el.dataset.tour = "desk-stop";
      else delete el.dataset.tour;
      el.dataset.step = STEP_ORDER[i];
    });
  });

  // ---------- The reply: what the person does with this message ----------
  let decide: ReactNode = null;
  const view = decideView({
    final: Boolean(final),
    testOnly: data.testOnly,
    safety,
    mode,
    sendOff,
    lock,
    permission,
    hasDraft: Boolean(draft),
  });
  if (view === "test_only") {
    decide = (
      <Block tone="neutral" title="Test set only">
        <p>This message is used to test the safety rules. It never reaches the desk, so nothing is sent from here.</p>
        <div className="mt-3">
          <Button size="sm" variant="secondary" leadingIcon={FlaskConical} href={`/tests/?case=${id}`}>
            Open it in Test results
          </Button>
        </div>
      </Block>
    );
  } else if (view === "clinician") {
    decide = <ClinicianOwns data={data} row={row} staffList={staffList} />;
  } else if (view === "escalate") {
    decide = (
      <Block tone="clinician" title="Escalate to a clinician">
        <p>The message moves to the clinician queue. Nothing is sent to {firstName} from the desk.</p>
        <Field label="Note for the clinician" hint="Optional. What made you escalate it?" className="mt-3">
          <TextArea
            ref={noteRef}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            className="bg-surface"
          />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <Hint label="Escalate" keys={["Ctrl", "Enter"]}>
            <Button leadingIcon={CornerUpRight} onClick={doEscalate}>
              Escalate
            </Button>
          </Hint>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      </Block>
    );
  } else if (view === "reassign") {
    const who = staffList.find((s) => s.id === assignee);
    decide = (
      <Block tone="neutral" title="Pass to a person">
        <p>Hand this message to a colleague. They write the reply.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Pass to">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="bg-surface">
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}, {COUNTRY_LABEL[s.country]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" hint="Optional">
            <TextArea
              ref={noteRef}
              rows={1}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
              className="min-h-11 bg-surface py-2.5"
            />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button leadingIcon={UserRoundCheck} onClick={doReassign} disabled={!assignee}>
            {who ? `Pass to ${firstNameOf(who.name)}` : "Pass on"}
          </Button>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      </Block>
    );
  } else if (view === "edit") {
    decide = (
      <div className="flex w-full flex-col gap-3">
        <div data-tour="desk-draft" className="w-full rounded-control border border-line-strong bg-surface">
          <div className="border-b border-line-cool px-4 py-2.5">
            <label htmlFor={`desk-editor-${id}`} className="text-xs font-semibold text-heading">
              {origin === "scratch" ? "Your reply" : "Editing the reply"}
            </label>
          </div>
          <div className="p-2">
            <TextArea
              ref={editorRef}
              id={`desk-editor-${id}`}
              autoGrow
              rows={8}
              value={text}
              aria-describedby={`desk-editor-${id}-check`}
              onChange={(e) => {
                setText(e.target.value);
                setAck(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
              className="border-transparent bg-surface px-2 hover:border-transparent hover:bg-surface"
            />
          </div>
          <div id={`desk-editor-${id}-check`} className="border-t border-line-cool px-4 py-3">
            <LiveCheck
              check={live}
              pending={pending}
              strict={strict}
              acknowledged={ack}
              onAcknowledge={setAck}
              onRewrite={selectForRewrite}
            />
          </div>
        </div>
        <div ref={trackBarClearance} data-desk-actions data-bottombar="" className={ACTION_BAR}>
          {!pending && <CheckFirstNote check={live} />}
          <div className="flex flex-wrap items-center gap-2">
            <Hint label="Send the reply" keys={["Ctrl", "Enter"]}>
              <Button leadingIcon={Send} onClick={doSendEdited} disabled={Boolean(editBlock)}>
                {origin === "scratch" ? "Send reply" : "Send edited reply"}
              </Button>
            </Hint>
            <Hint label="Cancel the edit" keys={["Esc"]}>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </Hint>
            {origin !== "scratch" && text !== original && (
              <Button
                variant="ghost"
                leadingIcon={RotateCcw}
                onClick={() => {
                  setText(original);
                  editorRef.current?.focus();
                }}
              >
                Back to the AI draft
              </Button>
            )}
          </div>
          {editBlock && !pending && (
            <p className="text-xs font-medium text-muted" aria-live="polite">
              Send is off: {editBlock}
            </p>
          )}
        </div>
      </div>
    );
  } else if (view === "held" && lock) {
    // Before the send and write branches, so a lock always wins, whatever the permission said a moment ago.
    // The banner above the message explains the lock once, in full. Here: the held draft and what can still be done.
    decide = (
      <div className="flex w-full flex-col gap-3">
        {lock.kind === "withdrawn" && (
          <p className="text-sm text-ink">Nothing can be sent from the desk. The note above the message says why.</p>
        )}
        {lock.kind === "check_clinician" && draft && (
          <>
            <div data-tour="desk-draft" className="w-full rounded-control border border-line-cool bg-surface">
              <DraftView
                draft={draft}
                sources={sources}
                firstName={firstName}
                agentName={agentName}
                heading="The checked draft, held for now"
                recent={result.recentMessageIds}
                muted
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Hint label="Escalate to a clinician" keys={["X"]}>
                <Button
                  variant="secondary"
                  leadingIcon={CornerUpRight}
                  onClick={() => openStep("escalate")}
                  data-return="escalate"
                >
                  Escalate to a clinician
                </Button>
              </Hint>
            </div>
          </>
        )}
      </div>
    );
  } else if (view === "send" && draft) {
    decide = (
      <div className="flex w-full flex-col gap-3">
        <div data-tour="desk-draft" className="w-full rounded-control border border-line-cool bg-surface">
          <DraftView draft={draft} sources={sources} firstName={firstName} agentName={agentName} recent={result.recentMessageIds} />
        </div>
        <div ref={trackBarClearance} data-desk-actions data-bottombar="" className={ACTION_BAR}>
          <CheckFirstNote check={result.check} showFacts />
          <div className="flex flex-wrap items-center gap-2">
            <Hint label="Send the reply" keys={["Ctrl", "Enter"]}>
              <Button leadingIcon={Send} onClick={doSendDraft} disabled={Boolean(draftHold)} data-tour="desk-send">
                Send
              </Button>
            </Hint>
            <Hint label="Edit the draft" keys={["E"]}>
              <Button variant="secondary" leadingIcon={Pencil} onClick={() => startEdit("draft")} data-return="edit">
                Edit
              </Button>
            </Hint>
            <Hint label="Escalate to a clinician" keys={["X"]}>
              <Button
                variant="secondary"
                leadingIcon={CornerUpRight}
                onClick={() => openStep("escalate")}
                data-return="escalate"
              >
                {/* On a phone the short label keeps the three buttons on one row; the tooltip says the rest. */}
                <span className="sm:hidden">Escalate</span>
                <span className="max-sm:hidden">Escalate to a clinician</span>
              </Button>
            </Hint>
          </div>
          <p className="text-xs text-muted" aria-live="polite">
            {draftHold ? `Send is off: ${draftHold} Edit the draft to fix it.` : `Nothing goes to ${firstName} until you press Send.`}
          </p>
        </div>
      </div>
    );
  } else if (view === "write") {
    decide = (
      <div className="flex w-full flex-col gap-3">
        <p className="text-sm text-ink">{whyPerson(result)}</p>
        <div className="flex flex-wrap items-center gap-2">
          {blockedDraft ? (
            <>
              <Hint label="Fix the blocked draft" keys={["E"]}>
                <Button leadingIcon={Pencil} onClick={() => startEdit("blocked")} data-return="fix">
                  Fix the blocked draft
                </Button>
              </Hint>
              <Button variant="secondary" onClick={() => startEdit("scratch")} data-return="scratch">
                Write from scratch
              </Button>
            </>
          ) : (
            <Hint label="Write the reply" keys={["E"]}>
              <Button leadingIcon={Pencil} onClick={() => startEdit("scratch")} data-return="write">
                Write the reply
              </Button>
            </Hint>
          )}
          <Hint label="Escalate to a clinician" keys={["X"]}>
            <Button
              variant="secondary"
              leadingIcon={CornerUpRight}
              onClick={() => openStep("escalate")}
              data-return="escalate"
            >
              Escalate to a clinician
            </Button>
          </Hint>
        </div>
      </div>
    );
  } else if (view === "none") {
    decide = <p className="text-sm text-ink">{sendOff ?? "Nothing to send from the desk for this message."}</p>;
  }

  // An edit that Send was switched off under keeps its text beside the reason, so nothing is lost.
  const keptNote: ReactNode =
    !final && kept ? (
      <KeptEdit
        ref={keptRef}
        text={kept.text}
        reason={sendOff}
        canResume={canWrite}
        onResume={() => startEdit(kept.origin)}
        onDiscard={() => {
          setKept(null);
          focusReturn(null);
        }}
      />
    ) : null;
  const body: ReactNode = final ? (
    <DecisionRecord decision={final} firstName={firstName} meId={staff.id} canUndo={undoableId === id} onUndo={onUndo} />
  ) : (
    <div className="flex flex-col gap-4">
      {keptNote}
      {handover && <HandoverNote decision={handover} meId={staff.id} canUndo={undoableId === id} onUndo={onUndo} />}
      {decide}
    </div>
  );

  const totalMs = result.trail.reduce((n, st) => n + (st.ms ?? 0), 0);
  const standIn = usedStandIn(result);
  const resting = result.mode === "deterministic_only" && !standIn;
  const holdShown = row ? row.holdActive : result.holdOrders;

  let verdict: string;
  if (final) verdict = `${decisionSummary(final, firstName, staff.id)}.`;
  else if (lock) verdict = lockVerdict(lock);
  else verdict = verdictText(result);

  // The one state word beside the reply's title: the checks still running, or a checked draft ready for review.
  const replyStatus: ReactNode = !revealed ? (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <LoaderCircle aria-hidden size={15} className="animate-spin text-muted-icon" />
      Running the checks
    </span>
  ) : view === "send" && !draftHold && !kept ? (
    <span className="inline-flex h-6 items-center gap-1 rounded-pill bg-success-bg px-2.5 text-xs font-semibold text-success-fg">
      <CircleCheck aria-hidden size={13} /> Facts checked
    </span>
  ) : null;

  // Passing the message to a colleague is the quieter action: it sits in the card's own menu, not beside Send.
  const canPass = !final && !handover && revealed && (view === "send" || view === "write");
  const reply = (
    <Card as="section" aria-labelledby={`desk-reply-title-${id}`} padding="none" data-tour="desk-reply" className="p-5 sm:p-6">
      <div ref={panelRef}>
        <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
          <h2 id={`desk-reply-title-${id}`} className="min-w-0 text-base font-semibold text-heading">
            Reply to {firstName}
            <span className="ml-2 text-sm font-normal text-muted max-sm:hidden">by {isEmail ? "email" : "chat"}</span>
          </h2>
          <span className="flex shrink-0 items-center gap-1">
            <span aria-live="polite">{replyStatus}</span>
            {canPass && <MoreActions onPass={() => openStep("reassign")} />}
          </span>
        </div>
        <div
          inert={!revealed}
          aria-busy={!revealed || undefined}
          className={cn("transition-opacity duration-200", revealed ? "opacity-100" : "opacity-40")}
        >
          {body}
        </div>
      </div>
    </Card>
  );

  const checks = (
    <Card as="section" aria-labelledby={`desk-trail-title-${id}`} padding="none" data-tour="desk-trail" className="p-5">
      <div ref={checksRef}>
        <div className="flex min-h-8 items-center justify-between gap-2">
          <h2 id={`desk-trail-title-${id}`} className="min-w-0 text-base font-semibold text-heading">
            Check trail
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            {resting && (
              <span className="inline-flex h-6 items-center rounded-pill bg-warning-bg px-2.5 text-xs font-semibold text-warning-fg">
                AI resting
              </span>
            )}
            {revealed && (
              <button
                type="button"
                data-trail-toggle=""
                aria-expanded={level !== "fold"}
                onClick={() =>
                  level === "full"
                    ? setLevel("steps", [], "toggle")
                    : level === "steps"
                      ? setLevel("fold", [], "toggle")
                      : setLevel("steps", [], "steps")
                }
                className="-mr-1.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-inner px-2 text-xs font-medium text-heading transition-colors duration-150 hover:bg-navy-900/[0.06] active:bg-navy-900/10"
              >
                {level === "fold" ? (
                  <ChevronsUpDown aria-hidden size={15} className="text-muted-icon" />
                ) : (
                  <ChevronsDownUp aria-hidden size={15} className="text-muted-icon" />
                )}
                {level === "full" ? "Show less" : level === "steps" ? "Hide steps" : "Show steps"}
              </button>
            )}
          </div>
        </div>
        {/* The verdict: what happened, in one line. On a locked row the lock speaks, never "Ready to send". */}
        <p className="mt-2 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1.5" aria-live="polite">
          {revealed ? (
            <>
              {row ? <StatusBadge meta={rowBadge(row)} /> : <RiskBadge route={result.route} />}
              {holdShown && <HoldBadge />}
              <span className="text-sm text-ink">{verdict}</span>
            </>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm text-muted">
              <LoaderCircle aria-hidden size={15} className="animate-spin text-muted-icon" />
              Running the checks
            </span>
          )}
        </p>
        <div ref={trailRef} className="mt-3">
          {level === "full" ? (
            <Trail
              key={`${id}-${detail.n}`}
              title={false}
              result={shownResult}
              animate={animate && !revealed}
              defaultOpen={detail.open}
              messageText={data.text}
              subject={isEmail}
              thread={data.thread}
              names={{ firstName, agentName }}
              onAnimationComplete={() => setRevealed(true)}
            />
          ) : level === "steps" ? (
            <TrailSteps
              result={shownResult}
              animate={animate && !revealed}
              onDone={() => setRevealed(true)}
              onOpenStep={(sid) => setLevel("full", [sid], sid)}
            />
          ) : (
            <TrailFold
              result={shownResult}
              animate={animate && !revealed}
              onDone={() => setRevealed(true)}
              onOpen={() => setLevel("steps", [], "steps")}
              caption={totalMs > 0 && revealed ? `7 steps, ${formatMs(totalMs)}` : undefined}
            />
          )}
        </div>
      </div>
    </Card>
  );

  // The trail shows only with the details, in their slot. Until then it stays out of view but keeps running.
  return (
    <>
      {reply}
      {detailsSlot ? createPortal(checks, detailsSlot) : <div hidden>{checks}</div>}
    </>
  );
}

type TrailLevel = "fold" | "steps" | "full";

/** The id of the tour stop showing now, or null when no tour is running. */
export function tourStopId(): string | null {
  const t = getTourSnapshot();
  return t ? (TOUR_STOPS[t.stop]?.id ?? null) : null;
}

/** The quieter actions, one click away: pass the message to a colleague. */
function MoreActions({ onPass }: { onPass: () => void }) {
  return (
    <Menu
      label="More actions"
      align="end"
      width={240}
      items={[
        {
          id: "pass",
          label: "Pass to a person",
          description: "A colleague writes the reply",
          icon: UserRoundPlus,
          onSelect: onPass,
        },
      ]}
      trigger={({ open, ...p }) => (
        <button
          {...p}
          type="button"
          aria-label="More actions"
          data-return="pass"
          className={cn(
            "-mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-inner text-muted-icon transition-colors duration-150 hover:bg-navy-900/[0.06] hover:text-heading active:bg-navy-900/10",
            open && "bg-navy-900/[0.06] text-heading",
          )}
        >
          <Ellipsis aria-hidden size={18} />
        </button>
      )}
    />
  );
}

const STEP_WORD: Partial<Record<DisplayState, string>> = {
  passed: "Passed",
  stopped: "Stopped here",
  failed: "Blocked",
  flagged: "Flagged",
  skipped: "Skipped",
  working: "Checking",
  awaiting: "Your call",
};

const STEP_WORD_TONE: Partial<Record<DisplayState, string>> = {
  passed: "text-success-fg",
  failed: "text-error-fg",
  flagged: "text-warning-fg",
  awaiting: "text-heading",
};

/** Steps that have something to show when opened (the decide step is the reply under the list). */
function stepHasDetail(step: { id: StepId; status: string }, result: PipelineResult): boolean {
  if (!EXPANDABLE_STEPS.includes(step.id) || step.status === "skipped" || step.status === "pending") return false;
  if (step.id === "sort") return Boolean(result.sort);
  if (step.id === "sources") return Boolean(result.sources);
  if (step.id === "draft") return Boolean(result.draft);
  if (step.id === "check") return Boolean(result.check);
  return true;
}

/**
 * The trail in short: the seven checks, one line each, ending at the person's decision. It ticks through on the first
 * open like the full trail. Each step with evidence opens the full trail in place, with that step expanded.
 */
function TrailSteps({
  result,
  animate,
  onDone,
  onOpenStep,
}: {
  result: PipelineResult;
  animate: boolean;
  onDone: () => void;
  onOpenStep: (id: StepId) => void;
}) {
  const steps = useMemo(() => normalizeTrail(result.trail), [result.trail]);
  const stopAt = stopIndex(steps);
  const shown = useReveal(result, animate, onDone);
  const animating = animate && shown < steps.length;
  const stopTone = result.route === "urgent" ? "urgent" : "clinician";
  return (
    <ol aria-label="The checks, in order" aria-busy={animating || undefined} className="flex flex-col">
      {steps.map((step, i) => {
        const state = displayStateFor(steps, i, shown, animating, false, stopAt);
        const isLast = i === steps.length - 1;
        const quiet = state === "pending" || state === "skipped";
        const word = step.id === "decide" && state === "passed" ? "Done" : (STEP_WORD[state] ?? "Waiting");
        const openable = !animating && stepHasDetail(step, result);
        const row = (
          <>
            <StatusIcon state={state} size="sm" stopTone={stopTone} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm font-medium transition-colors duration-200",
                quiet ? "text-muted" : "text-heading",
              )}
            >
              {step.title}
            </span>
            <span
              key={state}
              className={cn(
                "shrink-0 text-xs font-semibold",
                state === "pending" ? "invisible" : "animate-rise-in",
                // In the side column (1280 to 1535px) the tick says "Passed" on its own, so the step names fit; the
                // word stays for screen readers.
                state === "passed" && step.id !== "decide" && "xl:max-2xl:sr-only",
                STEP_WORD_TONE[state] ?? "text-muted",
              )}
            >
              <span className="sr-only">, </span>
              {word}
            </span>
            {openable ? (
              <ChevronDown aria-hidden size={15} className="shrink-0 text-muted-icon" />
            ) : (
              <span aria-hidden className="w-[15px] shrink-0" />
            )}
          </>
        );
        const rowClass = "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-inner px-2 py-1 text-left";
        return (
          <li key={step.id} className={cn("relative", !isLast && "pb-1")}>
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute -bottom-1 left-[9px] top-6 border-l-2 transition-colors duration-200",
                  state === "stopped" || state === "skipped"
                    ? "border-dashed border-line-strong"
                    : state === "passed"
                      ? "border-success-icon/45"
                      : "border-line-cool",
                )}
              />
            )}
            {openable ? (
              <button
                type="button"
                onClick={() => onOpenStep(step.id)}
                className={cn(rowClass, "transition-colors duration-150 hover:bg-navy-900/[0.04] active:bg-navy-900/[0.07]")}
              >
                {row}
                <span className="sr-only">. Show what this check found</span>
              </button>
            ) : (
              <div className={rowClass}>{row}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The folded trail's one line: how the checks came out, then where the decision stands. */
function foldSummary(states: DisplayState[], decide: DisplayState | undefined): string {
  const n = states.length;
  const count = (s: DisplayState) => states.filter((x) => x === s).length;
  const passed = count("passed");
  const extra = [
    [count("failed"), "blocked"],
    [count("flagged"), "flagged"],
    [count("stopped"), "stopped"],
    [count("skipped"), "skipped"],
  ]
    .filter(([k]) => Number(k) > 0)
    .map(([k, w]) => `${k} ${w}`);
  const checks = passed === n ? `All ${n} checks passed` : [`${passed} of ${n} checks passed`, ...extra].join(", ");
  const next = decide === "passed" ? "done" : decide === "awaiting" ? "your call" : null;
  return next ? `${checks}, ${next}` : checks;
}

/**
 * The trail folded to one row, as it opens beside the reply: the seven ticks in order along one line (the verdict above
 * says what they add up to), and a control that lays the steps out. It ticks through on the first open like the list
 * does. Screen readers hear the whole result: each step and its status.
 */
function TrailFold({
  result,
  animate,
  onDone,
  onOpen,
  caption,
}: {
  result: PipelineResult;
  animate: boolean;
  onDone: () => void;
  onOpen: () => void;
  /** How long the checks took, beside the ticks. */
  caption?: string;
}) {
  const steps = useMemo(() => normalizeTrail(result.trail), [result.trail]);
  const stopAt = stopIndex(steps);
  const shown = useReveal(result, animate, onDone);
  const animating = animate && shown < steps.length;
  const stopTone = result.route === "urgent" ? "urgent" : "clinician";
  const states = steps.map((_, i) => displayStateFor(steps, i, shown, animating, false, stopAt));
  const checks = states.filter((_, i) => steps[i].id !== "decide");
  const decide = states[steps.findIndex((s) => s.id === "decide")];
  const label = animating ? "Running the checks" : foldSummary(checks, decide);
  const spoken = steps
    .map((s, i) => `${s.title}: ${s.id === "decide" && states[i] === "passed" ? "Done" : (STEP_WORD[states[i]] ?? "Waiting")}`)
    .join(", ");
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        data-trail-fold=""
        aria-expanded={false}
        disabled={animating}
        onClick={onOpen}
        className="-mx-2 flex min-w-0 max-w-[16rem] flex-1 items-center rounded-inner px-2 py-2 transition-colors duration-150 enabled:hover:bg-navy-900/[0.04] enabled:active:bg-navy-900/[0.07]"
      >
        <span className="sr-only">
          {label}
          {!animating && <>. {spoken}. Show the steps</>}
        </span>
        {states.map((state, i) => (
          <Fragment key={steps[i].id}>
            <span aria-hidden className="shrink-0">
              <StatusIcon state={state} size="sm" stopTone={stopTone} />
            </span>
            {i < states.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-0.5 min-w-0.5 flex-1 transition-colors duration-200",
                  state === "passed" && states[i + 1] !== "pending" && states[i + 1] !== "working"
                    ? "bg-success-icon/45"
                    : "bg-line-cool",
                )}
              />
            )}
          </Fragment>
        ))}
      </button>
      {caption && <span className="ml-auto shrink-0 text-xs text-muted tnum">{caption}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A keyboard hint in a tooltip on hover and focus. */
function Hint({
  label,
  keys,
  children,
}: {
  label: string;
  keys: string[];
  children: React.ReactElement<{ "aria-describedby"?: string }>;
}) {
  return (
    <Tooltip
      content={
        <span className="inline-flex items-center gap-2">
          {label}
          <KeyCombo keys={keys} tone="onDark" />
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}

/**
 * Send and its neighbours stay in view while a long draft (and its sources) is read: the bar sticks to the bottom of
 * the conversation column on wide screens (past its 4px bottom padding), and of the screen on phones, and rests in
 * place once the end of the reply is reached.
 */
const ACTION_BAR_BOX =
  "z-10 -mx-5 flex flex-col gap-2 border-t border-line-cool bg-surface px-5 pb-3 pt-3 sm:-mx-6 sm:px-6";
const ACTION_BAR = `sticky bottom-0 lg:-bottom-1 ${ACTION_BAR_BOX}`;

const BLOCK_TONE = {
  neutral: { box: "bg-field", title: "text-heading" },
  clinician: { box: "bg-clinician-bg", title: "text-clinician-fg" },
  urgent: { box: "bg-urgent-bg", title: "text-urgent-fg" },
  warning: { box: "bg-warning-bg", title: "text-warning-fg" },
} as const;

function Block({ tone, title, children }: { tone: keyof typeof BLOCK_TONE; title: ReactNode; children: ReactNode }) {
  const t = BLOCK_TONE[tone];
  return (
    <div className={cn("w-full rounded-control p-4 text-sm text-ink", t.box)}>
      <p className={cn("font-semibold", t.title)}>{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ClinicianOwns({ data, row, staffList }: { data: CaseFile; row?: DeskRow; staffList: readonly StaffMember[] }) {
  const urgent = (row?.status ?? data.result.route) === "urgent";
  const doc = clinicianForCountry(staffList, data.patient.country);
  const rec = row?.clinicianRecord;
  const holdActive = row ? row.holdActive : data.result.holdOrders;
  const resumedNote = !holdActive && rec?.holdResumed ? rec.holdResumed.note : null;
  const news = resumedNote != null || (rec?.calls.length ?? 0) > 0 || (rec?.replies.length ?? 0) > 0 || Boolean(rec?.cleared);
  return (
    <Block
      tone={urgent ? "urgent" : "clinician"}
      title={urgent ? "A clinician answers first" : "A clinician answers this one"}
    >
      <p>
        {doc ? (
          <>
            <span className="font-medium">{doc.name}</span>, on call for {COUNTRY_LABEL[data.patient.country]}, has it{" "}
            {urgent ? "at the top of" : "in"} the clinician queue.
          </>
        ) : (
          <>It is {urgent ? "at the top of" : "in"} the clinician queue.</>
        )}{" "}
        There is no AI reply, and nothing can be sent from the desk.
      </p>
      {/* An active hold is already said by the verdict above and the stop in the trail: only a change is news here. */}
      {news && (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {resumedNote != null && <li>Orders resumed by the clinician: {resumedNote}</li>}
          {rec && rec.calls.length > 0 && (
            <li>Clinician called the patient ({rec.calls.length === 1 ? "once" : `${rec.calls.length} times`}).</li>
          )}
          {rec && rec.replies.length > 0 && <li>The clinician has replied to {data.patient.firstName}.</li>}
          {rec?.cleared && <li>Marked a false alarm: {rec.cleared.note}</li>}
        </ul>
      )}
      <div className="mt-3">
        <Button size="sm" variant="secondary" leadingIcon={Stethoscope} href={`/clinician/?m=${data.messageId}`}>
          Open in the clinician view
        </Button>
      </div>
    </Block>
  );
}

/**
 * An edit that Send was switched off under: why, and the agent's text, kept word for word so nothing is lost. Once
 * Send is back on (a clinician has been in touch), it can go back into the editor.
 */
function KeptEdit({
  ref,
  text,
  reason,
  canResume,
  onResume,
  onDiscard,
}: {
  ref?: Ref<HTMLDivElement>;
  text: string;
  /** Why Send is off now, or null once it is back on. */
  reason: string | null;
  canResume: boolean;
  onResume: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      data-desk-kept
      className={cn(
        "rounded-control p-4 text-sm text-ink focus:outline-none",
        reason ? "bg-warning-bg" : "bg-field",
      )}
    >
      <p className={cn("font-semibold", reason ? "text-warning-fg" : "text-heading")}>
        {reason ? "Send was switched off while you were editing" : "Your unsent reply is still here"}
      </p>
      {reason ? (
        <p className="mt-1">
          {reason} Nothing was sent. Your text is kept below, and goes back into the editor once Send is back on.
        </p>
      ) : (
        <p className="mt-1">Send is back on. Carry on where you left off, or discard it.</p>
      )}
      <p className="mt-2 whitespace-pre-wrap break-words rounded-inner bg-surface p-3 leading-relaxed text-ink">{text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {canResume && (
          <Button size="sm" leadingIcon={Pencil} onClick={onResume} data-return="resume">
            Carry on editing
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Discard it
        </Button>
      </div>
    </div>
  );
}

/** "Passed to Marco by you": the hand-over sits on top of the reply, which can still be written and sent here. */
function HandoverNote({
  decision,
  meId,
  canUndo,
  onUndo,
}: {
  decision: Extract<Decision, { kind: "reassigned" }>;
  meId: string;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const to = staffName(decision.to) ?? "a colleague";
  const by = decision.by === meId ? "you" : (staffName(decision.by) ?? "a colleague");
  const mine = decision.to === meId;
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-control bg-field px-4 py-3">
      <div className="flex min-w-0 items-start gap-2">
        <UserRoundCheck aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-heading">{mine ? `Passed to you by ${by}` : `Passed to ${to} by ${by}`}</p>
          {decision.note && <p className="mt-0.5 text-ink">Note: {decision.note}</p>}
          <p className="mt-0.5 text-xs text-muted">
            {mine
              ? "It is yours to answer now."
              : `${firstNameOf(to)} writes the reply. Anyone on the desk can still answer it here.`}
          </p>
        </div>
      </div>
      {canUndo && (
        <Button size="sm" variant="secondary" leadingIcon={Undo2} onClick={onUndo}>
          Undo
        </Button>
      )}
    </div>
  );
}

function DecisionRecord({
  decision,
  firstName,
  meId,
  canUndo,
  onUndo,
}: {
  decision: Decision;
  firstName: string;
  meId: string;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const who = decision.by === meId ? "You" : (staffName(decision.by) ?? "A colleague");
  let title = "";
  let body: ReactNode = null;
  switch (decision.kind) {
    case "sent":
    case "sent_edited":
      title =
        decision.kind === "sent"
          ? `${who} sent this reply to ${firstName}, as drafted`
          : `${who} sent this reply to ${firstName}, ${EDIT_WORDS[decision.edit] ?? "edited"}`;
      body = (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-inner bg-inset p-3 text-sm leading-relaxed text-ink">
          {decision.text}
        </p>
      );
      break;
    case "escalated":
      title = `${who} escalated this to a clinician`;
      body = decision.reason ? <p className="mt-1 text-sm text-ink">Note: {decision.reason}</p> : null;
      break;
    case "reassigned":
      title = `${who} passed this to ${staffName(decision.to) ?? "a colleague"}`;
      body = decision.note ? <p className="mt-1 text-sm text-ink">Note: {decision.note}</p> : null;
      break;
  }
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold text-heading">{title}</p>
        {canUndo && (
          <Button size="sm" variant="secondary" leadingIcon={Undo2} onClick={onUndo}>
            Undo
          </Button>
        )}
      </div>
      {body}
      <p className="mt-2 text-xs text-muted">In this demo nothing leaves your browser: sending is simulated.</p>
    </div>
  );
}

export function ReplySkeleton() {
  return (
    <Card padding="none" className="p-5 sm:p-6">
      <LoadingStatus label="Loading the reply" />
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-4 h-40 w-full" rounded="card" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-44" />
      </div>
    </Card>
  );
}

/** The check trail's card while the message loads: the header, the verdict and the folded row of ticks. */
export function ChecksSkeleton() {
  return (
    <Card padding="none" className="p-5">
      <Skeleton className="h-4 w-28" />
      <div className="mt-3 flex gap-2">
        <Skeleton rounded="pill" className="h-6 w-28" />
        <Skeleton className="h-4 w-40 self-center" />
      </div>
      <div className="mt-4 flex items-center gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} rounded="pill" className="size-5 shrink-0" />
        ))}
      </div>
    </Card>
  );
}
