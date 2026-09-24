"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell, useShell, type ShortcutGroup } from "@/components/shell";
import { ArrowRight, Stethoscope } from "lucide-react";
import { Button, PickPrompt, SampleNotice, SAMPLE_RUN_TEXT, isTypingTarget, cn } from "@/components/ui";
import { useMeta, prefetchCase } from "@/lib/client/data";
import { useDeskQueue } from "@/lib/client/session";
import { clinicianRows } from "@/lib/client/queue";
import { defaultEscalation, isHandled } from "./model";
import { QueueRail, type QueueFilter } from "./QueueRail";
import { Detail } from "./Detail";

export const CLINICIAN_SHORTCUTS: ShortcutGroup[] = [
  {
    title: "In the clinician queue",
    items: [
      { keys: ["J"], label: "Next escalation" },
      { keys: ["K"], label: "Previous escalation" },
      {
        keys: ["Ctrl", "Enter"],
        label: "Send your reply, from the reply box (Cmd on a Mac)",
      },
    ],
  },
  {
    title: "Anywhere",
    items: [
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["Esc"], label: "Close menus and panels" },
    ],
  },
];

const ID = /^MSG-\d{4}$/;

/** The shared sample-run sentence (components/ui/SampleNotice.tsx), the same on every screen. */
const SAMPLE_TEXT = SAMPLE_RUN_TEXT;

function normaliseId(raw: string | null): string | null {
  if (!raw) return null;
  const id = raw.trim().toUpperCase();
  return id || null;
}

/** The whole clinician screen: the shell, the escalation list and the open item. Reads ?m=<id> for deep links. */
export function ClinicianScreen() {
  return (
    <AppShell fullBleed shortcuts={CLINICIAN_SHORTCUTS}>
      <Suspense fallback={<ClinicianFallback />}>
        <ClinicianBody />
      </Suspense>
    </AppShell>
  );
}

/**
 * The same frame as the desk, and the same three steps: the list alone, then the item picked from it, then on request
 * its details (the order hold and the patient). A compact page header, then the rail card and the open item, each
 * scrolling on its own.
 */
const FRAME = "flex flex-1 flex-col lg:min-h-0";
const GRID =
  "grid min-h-0 flex-1 gap-4 px-4 pb-4 sm:px-6 lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)] lg:px-4 xl:grid-cols-[22rem_minmax(0,1fr)] 2xl:grid-cols-[24rem_minmax(0,1fr)]";
const PANE = "min-w-0 lg:relative lg:min-h-0 lg:overflow-y-auto lg:px-1 lg:pb-1";
/**
 * The open item keeps a readable width, centred in the pane. From 1280px, opening the details widens it for their
 * column (the width and the column's track move together, so nothing jumps).
 */
const ITEM = "mx-auto w-full max-w-[46rem] transition-[max-width] duration-300 ease-out-expo";
const ITEM_CLOSED = "xl:max-w-[47rem]";
const ITEM_OPEN = "xl:max-w-[1180px]";

function Header({ isSample, compact, className }: { isSample: boolean; compact?: boolean; className?: string }) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pb-3 pt-4 sm:px-6 lg:px-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="display-title text-2xl text-navy-900">Clinician queue</h1>
        <p className="text-sm text-muted">
          Messages the safety check sent to a clinician. No AI drafts here.
        </p>
      </div>
      {isSample &&
        (compact ? (
          <>
            {/* On a phone with an item open the header is for screen readers only, so the chip must not be a Tab stop. */}
            <span className="max-lg:hidden">
              <SampleNotice text={SAMPLE_TEXT} />
            </span>
            <span className="sr-only lg:hidden">Sample results: {SAMPLE_TEXT}</span>
          </>
        ) : (
          <SampleNotice text={SAMPLE_TEXT} />
        ))}
    </header>
  );
}

/** What the static page shows before the URL is read: the list loading, and the open item loading on a wide screen. */
function ClinicianFallback() {
  return (
    <div className={FRAME}>
      <Header isSample={false} />
      <div className={GRID}>
        <QueueRail
          status="loading"
          onRetry={() => {}}
          rows={[]}
          visible={[]}
          filter="todo"
          onFilter={() => {}}
          selectedId={null}
        />
      </div>
    </div>
  );
}

function ClinicianBody() {
  const params = useSearchParams();
  const router = useRouter();
  const shell = useShell();
  // Single-character shortcuts can be switched off in the shortcuts panel (WCAG 2.1.4), like on the desk.
  const singleKeys = (shell as { singleKeys?: boolean }).singleKeys !== false;
  const requested = normaliseId(params.get("m"));
  const queue = useDeskQueue();
  const meta = useMeta();
  const [filter, setFilter] = useState<QueueFilter>("todo");
  const paneRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => clinicianRows(queue.rows), [queue.rows]);
  const visible = useMemo(() => {
    if (filter === "all") return all;
    return all.filter((r) => (filter === "handled" ? isHandled(r) : !isHandled(r)));
  }, [all, filter]);

  // Nothing opens on its own: the list leads. The prompt beside it offers a clear urgent case to start with: the first
  // one the safety rules stopped on words in the message, not a cautious AI flag that is likely a false alarm.
  const firstPick = defaultEscalation(visible) ?? visible[0];
  const selectedId = requested;
  const row = selectedId ? queue.rows.find((r) => r.messageId === selectedId) : undefined;
  const ready = queue.status === "ready";
  // The details (the order hold and the patient) stay open from item to item once asked for, like a reading pane.
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!requested && firstPick && ready) prefetchCase(firstPick.messageId);
  }, [requested, firstPick, ready]);

  // A newly opened item starts at its top.
  useEffect(() => {
    const pane = paneRef.current;
    if (pane) pane.scrollTop = 0;
  }, [selectedId]);

  // On a phone the list and the open item take turns, so focus must follow: to the item's title when one opens, and
  // back to its row in the list when it closes. Otherwise it falls to the page and a keyboard user starts again.
  const [focusTitleFor, setFocusTitleFor] = useState<string | null>(null);
  const prevRequested = useRef(requested);
  useEffect(() => {
    const prev = prevRequested.current;
    prevRequested.current = requested;
    if (prev === requested) return;
    let narrow = false;
    try {
      narrow = !window.matchMedia("(min-width: 1024px)").matches;
    } catch {
      /* no matchMedia: leave focus alone */
    }
    if (!narrow) return;
    if (requested) {
      window.scrollTo(0, 0);
      // Set on the next frame, not during the effect: the item's title takes focus once it has loaded.
      const raf = window.requestAnimationFrame(() => setFocusTitleFor(requested));
      return () => window.cancelAnimationFrame(raf);
    }
    if (!prev) return;
    const restore = () => {
      const el = document.querySelector<HTMLElement>(`[data-row-id="${prev}"]`);
      if (!el) return false;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "center" });
      return true;
    };
    // The list shows again on the next frame; the router may reset the scroll first, so try once more after it.
    const raf = window.requestAnimationFrame(() => {
      restore();
      window.setTimeout(restore, 60);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [requested]);

  const go = useCallback(
    (id: string) => {
      router.push(`/clinician/?m=${id}`, { scroll: false });
      // The rail scrolls its own list to the new row; focus follows without moving the page.
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)?.focus({ preventScroll: true });
      });
    },
    [router],
  );

  // J and K move through the list in view, like the desk.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!singleKeys || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      // An open menu owns the keys. A tooltip does not: it opens on focus, so it must never swallow a shortcut.
      if (document.querySelector("[popover]:popover-open:not([role='tooltip'])")) return;
      const k = e.key.toLowerCase();
      if (k !== "j" && k !== "k") return;
      if (!visible.length) return;
      e.preventDefault();
      const i = visible.findIndex((r) => r.messageId === selectedId);
      const next = k === "j" ? Math.min(visible.length - 1, i + 1) : i < 0 ? 0 : Math.max(0, i - 1);
      const target = visible[next]?.messageId;
      if (target && target !== selectedId) go(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, go, singleKeys]);

  const validRequest = !requested || ID.test(requested);

  return (
    <div className={FRAME}>
      {/* On a phone with an item open, the title stays for screen readers and the back link leads the view. */}
      <Header
        isSample={Boolean(meta.data?.isMock)}
        compact={Boolean(requested)}
        className={cn(requested && "max-lg:sr-only")}
      />
      <div className={cn(GRID, requested && "max-lg:pt-4")}>
        <QueueRail
          status={queue.status}
          error={queue.error}
          onRetry={queue.retry}
          rows={all}
          visible={visible}
          filter={filter}
          onFilter={setFilter}
          selectedId={selectedId}
          className={cn(requested && "max-lg:hidden")}
        />
        <div ref={paneRef} className={cn(PANE, !requested && "max-lg:hidden")}>
          {!validRequest ? (
            <div className={cn(ITEM, ITEM_CLOSED)}>
              <Detail id={requested!} row={undefined} rows={queue.rows} queueReady={ready} />
            </div>
          ) : selectedId ? (
            <div className={cn(ITEM, detailsOpen ? ITEM_OPEN : ITEM_CLOSED)}>
              <Detail
                key={selectedId}
                id={selectedId}
                row={row}
                rows={queue.rows}
                queueReady={ready}
                focusTitle={focusTitleFor === selectedId}
                detailsOpen={detailsOpen}
                onDetailsChange={setDetailsOpen}
              />
            </div>
          ) : queue.status === "error" ? null : ready && visible.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted">Nothing to open in this view.</p>
          ) : (
            // Step one: only the list. This side says what opens here, with a shortcut to a clear first case.
            <PickPrompt
              icon={Stethoscope}
              title="The escalation opens here"
              action={
                ready &&
                firstPick && (
                  <Button trailingIcon={ArrowRight} onClick={() => go(firstPick.messageId)}>
                    Open {firstPick.firstName}&apos;s message
                  </Button>
                )
              }
            >
              Pick one from the list. You will see why it stopped, the patient&apos;s own words, and where to reply.
            </PickPrompt>
          )}
        </div>
      </div>
    </div>
  );
}
