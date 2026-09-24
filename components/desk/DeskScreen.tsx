"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, MessageSquareText, SearchX } from "lucide-react";
import { useCase, useMeta, prefetchCase } from "@/lib/client/data";
import { replyPermission, type DeskRow } from "@/lib/client/queue";
import { RESET_EVENT, useDeskQueue, useSession } from "@/lib/client/session";
import { initialState, sessionReducer } from "@/lib/client/session-state";
import {
  Button,
  Card,
  DetailsHeader,
  EmptyState,
  IconButton,
  Notice,
  PickPrompt,
  SampleNotice,
  SAMPLE_RUN_TEXT,
  cn,
  useToast,
  isTypingTarget,
} from "@/components/ui";
import { subscribeTour } from "@/components/tour/state";
import { prefersReducedMotion } from "@/components/trail/reveal";
import { useShell } from "@/components/shell";
import {
  filterCounts,
  filterFor,
  firstNameOf,
  isDeskFilter,
  isDeskSort,
  isSafety,
  matchesFilter,
  matchesQuery,
  nextAfter,
  sendBlockReason,
  visibleRows,
  type DeskFilter,
  type DeskSort,
} from "./desk-model";
import { QueueRail } from "./QueueRail";
import { MessagePanel, MessageSkeleton, PatientCard } from "./MessagePanel";
import {
  ChecksSkeleton,
  ReplyPanel,
  ReplySkeleton,
  tourStopId,
  type ReplyPanelHandle,
  type RestoreReply,
} from "./ReplyPanel";

const VIEW_KEY = "caredesk.desk.view";

/**
 * The desk opens in three steps, one new thing at a time: the queue alone (the rest of the screen says what opens
 * there), then the message picked from it with its reply, then, when asked for, the details (the check trail and the
 * patient). One row that fills the height, so each column scrolls on its own. From 1280px the details are a third
 * column: its track is 0 wide until they open, so the column slides in and the conversation re-centres smoothly.
 * Between 1024 and 1279px the details open under the reply instead.
 */
const GRID_BASE = "lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[18.5rem_minmax(0,1fr)]";
const GRID_CLOSED = "xl:grid-cols-[20rem_minmax(0,1fr)_0rem] 2xl:grid-cols-[22rem_minmax(0,1fr)_0rem]";
const GRID_OPEN = "xl:grid-cols-[20rem_minmax(0,1fr)_20rem] 2xl:grid-cols-[22rem_minmax(0,1fr)_24rem]";
const GRID_MOTION = "xl:transition-[grid-template-columns] xl:duration-300 xl:ease-out-expo";
/** On the tour the details column slides in slowly, one part at a time (the tour card waits for it). */
const GRID_MOTION_TOUR = "xl:transition-[grid-template-columns] xl:duration-[900ms] xl:ease-in-out";
/** The conversation keeps a readable width, centred in whatever room the columns leave it. */
const CONVERSATION = "mx-auto flex w-full max-w-[46rem] flex-col gap-4 2xl:max-w-[50rem]";
/**
 * The details column. Its content keeps its full width while the track opens, anchored to the right edge, so it is
 * uncovered from the right rather than squeezed; the clipped part never scrolls.
 */
const SIDE_COLUMN = "flex min-w-0 flex-col items-end overflow-x-hidden lg:min-h-0 lg:overflow-y-auto lg:px-1 lg:pb-1";
const SIDE_INNER = "w-[19.5rem] shrink-0 2xl:w-[23.5rem]";
const DETAILS_ID = "desk-details";

function readView(): { filter: DeskFilter; sort: DeskSort } {
  try {
    const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? "null") as { filter?: unknown; sort?: unknown } | null;
    return { filter: isDeskFilter(v?.filter) ? v.filter : "all", sort: isDeskSort(v?.sort) ? v.sort : "priority" };
  } catch {
    return { filter: "all", sort: "priority" };
  }
}

function writeView(v: { filter: DeskFilter; sort: DeskSort }) {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* storage blocked: the view resets next visit */
  }
}

/** From here the details (the check trail and the patient) open as their own column beside the conversation. */
const SIDE_QUERY = "(min-width: 1280px)";
/** Below the desk's three columns (also desktop at 200% zoom): one column at a time, the queue or the message. */
const NARROW_QUERY = "(max-width: 1023.98px)";

function isNarrow(): boolean {
  try {
    return window.matchMedia(NARROW_QUERY).matches;
  } catch {
    return false;
  }
}

function subscribeSide(onChange: () => void): () => void {
  try {
    const mq = window.matchMedia(SIDE_QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  } catch {
    return () => {};
  }
}

function hasSide(): boolean {
  try {
    return window.matchMedia(SIDE_QUERY).matches;
  } catch {
    return true;
  }
}

function deskHref(id: string | null | undefined): string {
  return id ? `/desk/?m=${encodeURIComponent(id)}` : "/desk/";
}

/** The agent's desk: the queue, the message picked from it with its reply, and on request its details. */
export function DeskScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const session = useSession();
  const shell = useShell();
  // Single-character shortcuts can be switched off in the shortcuts panel (WCAG 2.1.4). Ctrl+Enter and Esc stay on.
  const singleKeys = (shell as { singleKeys?: boolean }).singleKeys !== false;
  const { toast, dismiss } = useToast();
  const queue = useDeskQueue();
  const meta = useMeta();

  const urlId = params.get("m");
  // Remembered filter and sort (a per-visitor convenience). This component only renders in the browser (it reads the
  // search params inside a Suspense boundary), so reading storage for the first state cannot cause a mismatch.
  const [filter, setFilterState] = useState<DeskFilter>(() => readView().filter);
  const [sort, setSortState] = useState<DeskSort>(() => readView().sort);
  const [query, setQuery] = useState("");
  // Clinician and urgent rows fold into one group in the "All" view: nothing there is for the desk to send.
  const [safetyOpen, setSafetyOpen] = useState(false);
  // The details (the check trail and the patient) open with every message. Hide details closes them for that message
  // only: the next message opens with them again, and so does Reset the demo.
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const side = useSyncExternalStore(subscribeSide, hasSide, () => true);
  const searchRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<ReplyPanelHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusOnOpen = useRef(false);

  const setFilter = useCallback((f: DeskFilter) => {
    setFilterState(f);
    writeView({ ...readView(), filter: f });
  }, []);
  const setSort = useCallback((s: DeskSort) => {
    setSortState(s);
    writeView({ ...readView(), sort: s });
  }, []);

  // "Reset the demo" puts the view back to the start as well.
  useEffect(() => {
    const onReset = () => {
      setFilterState("all");
      setSortState("priority");
      setQuery("");
      setSafetyOpen(false);
      setClosedFor(null);
    };
    window.addEventListener(RESET_EVENT, onReset);
    return () => window.removeEventListener(RESET_EVENT, onReset);
  }, []);

  const status = queue.status === "ready" && !queue.sessionReady ? "loading" : queue.status;
  const rows = queue.rows;
  const counts = useMemo(() => filterCounts(rows), [rows]);
  const visible = useMemo(() => visibleRows(rows, filter, query, sort), [rows, filter, query, sort]);
  const grouping = filter === "all" && !query.trim();
  // The rows J, K and "next message" move through: the folded clinician group is skipped until it is opened.
  const nav = useMemo(
    () => (grouping && !safetyOpen ? visible.filter((r) => !isSafety(r)) : visible),
    [visible, grouping, safetyOpen],
  );
  // Nothing opens on its own: the queue leads, and a message opens once it is picked (or from a link with ?m=).
  const selectedId = urlId;
  const detailsOpen = !!selectedId && closedFor !== selectedId;
  // The prompt's shortcut: the first checked draft, which in the Priority sort is the first row for the desk.
  const firstPick = nav.find((r) => r.status === "ready" && r.sendable) ?? nav[0] ?? visible[0];
  const row: DeskRow | undefined = useMemo(() => rows.find((r) => r.messageId === selectedId), [rows, selectedId]);
  const caseRes = useCase(selectedId);
  const permission = row ? replyPermission(row) : "blocked";
  // Passed to a colleague is a hand-over: the reply can still be written and sent, when the session accepts it.
  const handoverOpen = useMemo(() => {
    if (row?.decision?.kind !== "reassigned") return false;
    const probe = initialState(session.data);
    const after = sessionReducer(probe, {
      type: "send",
      messageId: row.messageId,
      at: row.decision.at,
      by: session.staff.id,
      text: "probe",
    });
    return after !== probe;
  }, [row, session.data, session.staff.id]);
  const position = nav.findIndex((r) => r.messageId === selectedId);

  // A deep link to a message the current view hides: switch to a filter that shows it (once per link, during render).
  const [adjustedFor, setAdjustedFor] = useState<string | null>(null);
  if (urlId && status === "ready" && adjustedFor !== urlId) {
    setAdjustedFor(urlId);
    const r = rows.find((x) => x.messageId === urlId);
    const nextFilter = r && !matchesFilter(r, filter) ? filterFor(r) : filter;
    if (nextFilter !== filter) setFilterState(nextFilter);
    if (r && query && !matchesQuery(r, query)) setQuery("");
    if (r && isSafety(r) && nextFilter === "all") setSafetyOpen(true);
  }

  // Warm the next case so J feels instant.
  useEffect(() => {
    const next = nav[position + 1];
    if (next) prefetchCase(next.messageId);
  }, [nav, position]);

  // New message: both columns start at the top; on narrow screens the page does too. There the queue hides while a
  // message is open, so a focused queue row would drop focus to the page body: the message heading takes it instead.
  const middleRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    middleRef.current?.scrollTo({ top: 0 });
    rightRef.current?.scrollTo({ top: 0 });
    if (!urlId || !isNarrow()) return;
    window.scrollTo({ top: 0 });
    const active = document.activeElement;
    if (!active || active === document.body || active.closest("[data-tour='desk-queue']")) focusOnOpen.current = true;
  }, [selectedId, urlId]);

  // After a decision (or an open on a narrow screen), focus lands on the message's heading, not on the page body.
  // Runs after every render until the heading of the open message is there.
  useEffect(() => {
    if (!focusOnOpen.current || caseRes.status !== "ready" || caseRes.data?.messageId !== selectedId) return;
    const heading = headingRef.current;
    if (!heading) return;
    focusOnOpen.current = false;
    heading.focus({ preventScroll: true });
  });

  // "Back to the queue" on a narrow screen: focus returns to the row the agent came from, scrolled into view, and that
  // row is the list's Tab stop.
  const returnTo = useRef<string | null>(null);
  const [tabPrefer, setTabPrefer] = useState<string | null>(null);
  useEffect(() => {
    const id = returnTo.current;
    if (urlId || !id || status !== "ready") return;
    returnTo.current = null;
    const link =
      document.querySelector<HTMLElement>(`[data-row="${id}"] a[data-queue-link]`) ??
      document.querySelector<HTMLElement>("[data-tour='desk-queue'] a[data-queue-link][tabindex='0']");
    if (!link) return;
    link.focus({ preventScroll: true });
    link.scrollIntoView({ block: "center" });
  });
  const goBack = useCallback(() => {
    returnTo.current = selectedId;
    setTabPrefer(selectedId);
    router.push("/desk/", { scroll: false });
  }, [router, selectedId]);

  const open = useCallback(
    (id: string | null, focus = false) => {
      focusOnOpen.current = focus;
      router.replace(deskHref(id), { scroll: false });
    },
    [router],
  );
  /** Opening from the prompt is like clicking a row: a new history entry, and focus on the message that opened. */
  const pick = useCallback(
    (id: string) => {
      focusOnOpen.current = true;
      router.push(deskHref(id), { scroll: false });
    },
    [router],
  );

  // ---------- Details: the check trail and the patient, one click away ----------
  // On the tour the desk opens one part at a time: the queue, then the message (fading in), then at the check trail
  // stop the details, sliding in slowly. The tour card waits for each to land (TourStop.settleMs).
  const tourStop = useSyncExternalStore(subscribeTour, tourStopId, () => null);
  const touring = tourStop !== null;
  const showDetails = touring ? tourStop === "checks" : detailsOpen;
  // The slot the reply panel renders the check trail into (it owns the trail's state).
  const [detailsSlot, setDetailsSlot] = useState<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusDetails = useRef(false);
  const toggleDetails = useCallback(() => {
    // Below 1280px the details open under the reply, out of sight: they are brought into view and take focus.
    if (!showDetails && !hasSide()) focusDetails.current = true;
    setClosedFor(showDetails ? (selectedId ?? null) : null);
  }, [showDetails, selectedId]);
  const closeDetails = useCallback(() => {
    setClosedFor(selectedId ?? null);
    window.requestAnimationFrame(() => toggleRef.current?.focus());
  }, [selectedId]);
  useEffect(() => {
    if (!focusDetails.current || !showDetails) return;
    const el = detailsRef.current;
    if (!el) return;
    focusDetails.current = false;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  });

  const move = useCallback(
    (delta: 1 | -1) => {
      if (!nav.length) return;
      const i = position < 0 ? (delta === 1 ? 0 : nav.length - 1) : position + delta;
      const target = nav[Math.max(0, Math.min(nav.length - 1, i))];
      if (target && target.messageId !== selectedId) open(target.messageId);
    },
    [nav, position, selectedId, open],
  );

  // ---------- Decisions ----------
  const sessionRef = useRef(session);
  const rowsRef = useRef(rows);
  useEffect(() => {
    sessionRef.current = session;
    rowsRef.current = rows;
  });

  /**
   * Defence in depth for every send: re-read the row as the session has it now (a lock can arrive from another tab
   * between the render and the click) and refuse while it is locked or blocked, whatever the reply panel showed.
   */
  const sendAllowed = useCallback((): boolean => {
    const latest = rowsRef.current.find((r) => r.messageId === selectedId);
    const reason = latest
      ? sendBlockReason({ permission: replyPermission(latest), lock: latest.lock })
      : "This message is not in the queue.";
    if (!reason) return true;
    toast({ message: "Not sent", detail: reason, tone: "error" });
    return false;
  }, [selectedId, toast]);

  /**
   * A reply the agent edited (or wrote) and then undid comes back in the editor exactly as it was sent: the usual
   * reason to undo is a typo just spotted, so the edit must not be lost.
   */
  const [restore, setRestore] = useState<(RestoreReply & { id: string }) | null>(null);

  const undoFor = useCallback(
    (id: string) => {
      const s = sessionRef.current;
      if (s.lastAction?.messageId !== id) {
        toast({ message: "Only your most recent action can be undone", detail: "Open that message to see what happened." });
        return;
      }
      const before = s.decisionFor(id);
      const undone = s.undo();
      if (!undone) return;
      if (before?.kind === "sent_edited") {
        setRestore({ id, text: before.text, original: before.original });
        // Focus goes to the editor (the reply panel places it), not to the message heading.
        open(id, false);
        toast({
          message: before.original
            ? "Undone. Your edited reply is back for changes."
            : "Undone. Your reply is back for changes.",
        });
        return;
      }
      open(id, true);
      toast({ message: `Undone: ${undone.label.toLowerCase()}`, detail: "The message is back in the queue." });
    },
    [open, toast],
  );

  /** The last decision's toast and the message it opened, so it can go once the agent moves on. */
  const decisionToast = useRef<{ id: number; next: string; arrived: boolean } | null>(null);
  const decide = useCallback(
    (run: () => boolean, done: (first: string) => string) => {
      if (!selectedId || !row) return;
      const id = selectedId;
      const first = row.firstName;
      const next = nextAfter(nav, id);
      if (!run()) {
        toast({ message: "Nothing changed", detail: "This message already has a decision.", tone: "error" });
        return;
      }
      open(next?.messageId ?? null, true);
      const toastId = toast({
        message: `${done(first)} ${next ? "Next message opened." : "That was the last one in this view."}`,
        detail: next ? `Next: ${next.firstName}, ${next.subject ?? next.preview}` : undefined,
        tone: "success",
        onUndo: () => undoFor(id),
      });
      decisionToast.current = next ? { id: toastId, next: next.messageId, arrived: false } : null;
    },
    [selectedId, row, nav, open, toast, undoFor],
  );

  // The decision toast names the message that opened next. Once the agent moves on from that one it is out of date,
  // so it goes; Undo stays on the message's own record in the Done view.
  useEffect(() => {
    const t = decisionToast.current;
    if (!t) return;
    if (selectedId === t.next) {
      t.arrived = true;
      return;
    }
    if (!t.arrived) return;
    decisionToast.current = null;
    dismiss(t.id);
  }, [selectedId, dismiss]);

  const onSend = useCallback(
    (text: string) => {
      if (sendAllowed()) decide(() => session.send(selectedId!, text), (f) => `Sent to ${f}.`);
    },
    [decide, session, selectedId, sendAllowed],
  );
  const onSendEdited = useCallback(
    (text: string, original: string) => {
      if (sendAllowed()) decide(() => session.sendEdited(selectedId!, text, original), (f) => `Sent to ${f}.`);
    },
    [decide, session, selectedId, sendAllowed],
  );
  const onEscalate = useCallback(
    (reason?: string) => decide(() => session.escalate(selectedId!, reason), () => "Escalated to a clinician."),
    [decide, session, selectedId],
  );
  const onReassign = useCallback(
    (to: string, note?: string) => {
      const who = session.staffList.find((s) => s.id === to)?.name;
      decide(() => session.reassign(selectedId!, to, note), () => `Passed to ${who ? firstNameOf(who) : "a colleague"}.`);
    },
    [decide, session, selectedId],
  );

  const onReset = useCallback(() => {
    const changed = session.resetDemo();
    if (changed) {
      toast({ message: "Demo reset", detail: "Every message is back in the queue.", tone: "success", onUndo: () => session.undo() });
    } else {
      toast({ message: "Nothing to reset", detail: "The demo is already at the start." });
    }
  }, [session, toast]);

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      const typing = isTypingTarget(e.target);
      const inReply = e.target instanceof Element && Boolean(e.target.closest("[data-desk-reply]"));
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (typing && !inReply) return;
        e.preventDefault();
        if (!replyRef.current?.send()) {
          toast({ message: "Nothing to send here", detail: "Only a checked draft or your own reply can be sent." });
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || typing || !singleKeys) return;
      // An open menu owns the keys. A tooltip or toggletip (the visual-only popover of the Sample results chip) does not.
      if (document.querySelector("[popover]:popover-open:not([role='tooltip']):not([aria-hidden='true'])")) return;
      const k = e.key.toLowerCase();
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (k === "j") {
        e.preventDefault();
        move(1);
      } else if (k === "k") {
        e.preventDefault();
        move(-1);
      } else if (k === "e") {
        if (replyRef.current?.edit()) e.preventDefault();
      } else if (k === "x") {
        if (replyRef.current?.escalate()) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, toast, singleKeys]);

  // ---------- Render ----------
  const isMock = meta.data?.isMock === true;
  const showDetailOnPhone = Boolean(urlId);

  let detail: React.ReactNode;
  if (status === "error" && !(caseRes.status === "ready" && caseRes.data?.testOnly)) {
    // The rail says what went wrong and offers Try again. The detail pane stays empty rather than claim "All caught up".
    detail = null;
  } else if (!selectedId) {
    // Step one: only the queue. The rest of the screen says what opens here, with a shortcut to a good first message.
    detail = (
      <div className="lg:col-[2/-1] lg:min-h-0 lg:overflow-y-auto">
        {status === "ready" && visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">Nothing to open in this view.</p>
        ) : (
          <PickPrompt
            icon={MessageSquareText}
            badge={{ icon: Check, className: "bg-success-bg text-success-icon" }}
            title="Your next message opens here"
            action={
              firstPick && (
                <Button trailingIcon={ArrowRight} onClick={() => pick(firstPick.messageId)}>
                  Open {firstPick.firstName}&apos;s message
                </Button>
              )
            }
          >
            Pick one from the queue. The green ones arrive with a reply already drafted and checked.
          </PickPrompt>
        )}
      </div>
    );
  } else if (caseRes.status === "error") {
    detail = (
      <div className="lg:col-[2/-1]">
        <Card>
          {caseRes.error?.kind === "not_found" ? (
            <EmptyState icon={SearchX} title="This message could not be found">
              <p>The link may have a typo. Message ids look like MSG-0026.</p>
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" href="/desk/">
                  Back to the queue
                </Button>
              </div>
            </EmptyState>
          ) : (
            <Notice
              tone="error"
              role="alert"
              title="This message did not load"
              actions={
                <Button size="sm" variant="secondary" onClick={caseRes.retry}>
                  Try again
                </Button>
              }
            >
              {caseRes.error?.message}
            </Notice>
          )}
        </Card>
      </div>
    );
  } else if (caseRes.status !== "ready" || !caseRes.data || (status !== "ready" && !caseRes.data.testOnly)) {
    detail = <DetailSkeleton details={side && showDetails} />;
  } else {
    const data = caseRes.data;
    // Step three, open with the message: the check trail (placed by the reply panel) and the patient, under one close
    // button.
    const details = showDetails ? (
      <section
        ref={detailsRef}
        id={DETAILS_ID}
        tabIndex={-1}
        aria-labelledby="desk-details-title"
        className={cn("flex min-w-0 flex-col gap-4 outline-none", side ? "animate-panel-in" : "animate-rise-in")}
      >
        <DetailsHeader id="desk-details-title" onClose={closeDetails} />
        <div ref={setDetailsSlot} className="contents" />
        <PatientCard data={data} row={row} rows={rows} />
      </section>
    ) : null;
    detail = (
      <>
        <div
          key={data.messageId}
          ref={middleRef}
          data-desk-reply
          className={cn("min-w-0 lg:min-h-0 lg:overflow-y-auto lg:px-1 lg:pb-1", touring && "animate-tour-reveal")}
        >
          <div data-tour="desk-conversation" className={CONVERSATION}>
            <MessagePanel
              ref={headingRef}
              data={data}
              row={row}
              details={{
                open: showDetails,
                onToggle: toggleDetails,
                controls: DETAILS_ID,
                layout: side ? "side" : "inline",
                hint: `The check trail, and ${data.patient.firstName}'s plan and order`,
              }}
              detailsToggleRef={toggleRef}
            />
            <ReplyPanel
              key={data.messageId}
              handleRef={replyRef}
              data={data}
              row={row}
              permission={permission}
              staff={session.staff}
              staffList={session.staffList}
              undoableId={session.lastAction?.messageId ?? null}
              onSend={onSend}
              onSendEdited={onSendEdited}
              onEscalate={onEscalate}
              onReassign={onReassign}
              onUndo={() => undoFor(data.messageId)}
              handoverOpen={handoverOpen}
              restore={restore?.id === data.messageId ? restore : null}
              onRestored={() => setRestore(null)}
              detailsSlot={showDetails ? detailsSlot : null}
            />
            {/* Below 1280px the details follow the reply. */}
            {!side && details}
          </div>
        </div>
        {side && details && (
          <div ref={rightRef} className={SIDE_COLUMN}>
            <div className={SIDE_INNER}>{details}</div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-1 flex-col lg:min-h-0">
      <header
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pb-3 pt-4 sm:px-6 lg:px-4",
          showDetailOnPhone && "max-lg:hidden",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="display-title text-2xl text-navy-900">Desk</h1>
          <p className="text-sm text-muted">{DESK_INTRO}</p>
        </div>
        {isMock && <SampleNotice text={SAMPLE_TEXT} />}
      </header>

      {/* The header is hidden while a message fills a phone screen; the page keeps its title for screen readers. */}
      {showDetailOnPhone && (
        <h1 className="sr-only lg:hidden">Desk</h1>
      )}
      {showDetailOnPhone && (
        <PhoneBar
          position={position}
          total={nav.length}
          onBack={goBack}
          onPrev={() => move(-1)}
          onNext={() => move(1)}
        />
      )}

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-4 px-4 pb-4 sm:px-6 lg:px-4",
          GRID_BASE,
          selectedId && showDetails ? GRID_OPEN : GRID_CLOSED,
          touring ? GRID_MOTION_TOUR : GRID_MOTION,
        )}
      >
        <QueueRail
          className={cn(showDetailOnPhone && "max-lg:hidden")}
          status={status}
          error={queue.error}
          onRetry={queue.retry}
          rows={visible}
          counts={counts}
          filter={filter}
          onFilter={setFilter}
          query={query}
          onQuery={setQuery}
          sort={sort}
          onSort={setSort}
          // With no message open nothing is selected, so the first row is the list's Tab stop.
          selectedId={selectedId}
          followSelected={Boolean(urlId)}
          searchRef={searchRef}
          onShortcuts={shell.openShortcuts}
          onShowDone={() => setFilter("done")}
          onReset={onReset}
          safetyGroup={grouping ? { open: safetyOpen, onToggle: () => setSafetyOpen((o) => !o) } : undefined}
          tabPreferId={urlId ? null : tabPrefer}
        />
        <div className={cn("contents", !showDetailOnPhone && "max-lg:hidden")}>{detail}</div>
      </div>
    </div>
  );
}

/** One line under the title: how to read the queue at a glance. */
const DESK_INTRO = "Pick a message. Green means a checked draft is ready; anything clinical is already with a clinician.";

/** The shared sample-run sentence (components/ui/SampleNotice.tsx), the same on every screen. */
const SAMPLE_TEXT = SAMPLE_RUN_TEXT;

/**
 * The phone bar sticks under the top bar, so a control scrolled up under the pair must still show when it takes focus
 * (WCAG 2.4.11): their combined height is reserved as the page's top scroll padding while the bar is shown. It is gone
 * (height 0) from 1024px up, and the padding goes with it.
 */
function trackTopClearance(bar: HTMLDivElement | null): (() => void) | undefined {
  if (!bar) return undefined;
  const root = document.documentElement;
  const apply = () => {
    const h = bar.offsetHeight;
    const top = parseFloat(window.getComputedStyle(bar).top) || 0;
    root.style.scrollPaddingTop = h ? `${Math.ceil(top + h) + 8}px` : "";
  };
  apply();
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
  ro?.observe(bar);
  return () => {
    ro?.disconnect();
    root.style.scrollPaddingTop = "";
  };
}

function PhoneBar({
  position,
  total,
  onBack,
  onPrev,
  onNext,
}: {
  position: number;
  total: number;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div ref={trackTopClearance} data-subbar="" className="sticky top-16 z-30 flex items-center gap-2 border-b border-line bg-canvas px-4 py-2 sm:px-6 lg:hidden">
      <Button variant="ghost" size="md" leadingIcon={ArrowLeft} onClick={onBack} className="-ml-2">
        Back to the queue
      </Button>
      <span className="ml-auto text-xs text-muted tnum">{position >= 0 ? `${position + 1} of ${total}` : ""}</span>
      <IconButton icon={ChevronUp} label="Previous message" variant="subtle" onClick={onPrev} disabled={position <= 0} />
      <IconButton
        icon={ChevronDown}
        label="Next message"
        variant="subtle"
        onClick={onNext}
        disabled={position < 0 || position >= total - 1}
      />
    </div>
  );
}

/** A message loading: the conversation's shape, and the details column's when the details are open. */
function DetailSkeleton({ details = false }: { details?: boolean }) {
  return (
    <>
      <div className="min-w-0 lg:px-1">
        <div className={CONVERSATION}>
          <MessageSkeleton />
          <ReplySkeleton />
        </div>
      </div>
      {details && (
        <div className="min-w-0 max-xl:hidden lg:px-1">
          <ChecksSkeleton />
        </div>
      )}
    </>
  );
}

/** Static first paint (before the search params are read): the queue loading, and nothing else yet. */
export function DeskFallback() {
  return (
    <div className="flex flex-1 flex-col lg:min-h-0">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 pb-3 pt-4 sm:px-6 lg:px-4">
        <h1 className="display-title text-2xl text-navy-900">Desk</h1>
        <p className="text-sm text-muted">{DESK_INTRO}</p>
      </header>
      <div className={cn("grid min-h-0 flex-1 gap-4 px-4 pb-4 sm:px-6 lg:px-4", GRID_BASE, GRID_CLOSED)}>
        <QueueRail
          status="loading"
          onRetry={() => {}}
          rows={[]}
          counts={{ all: 0, person: 0, ready: 0, safety: 0, done: 0 }}
          filter="all"
          onFilter={() => {}}
          query=""
          onQuery={() => {}}
          sort="priority"
          onSort={() => {}}
          selectedId={null}
          searchRef={{ current: null }}
          onShortcuts={() => {}}
          onShowDone={() => {}}
          onReset={() => {}}
        />
      </div>
    </div>
  );
}
