"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  Inbox,
  Keyboard,
  Mail,
  MessageCircle,
  Search,
  SearchX,
  ShieldAlert,
  Stethoscope,
  X,
} from "lucide-react";
import type { DeskRow } from "@/lib/client/queue";
import type { DataError, ResourceStatus } from "@/lib/client/data";
import { prefetchCase } from "@/lib/client/data";
import { COUNTRY_LABEL, waitingTime } from "@/lib/format";
import { Button, Chip, EmptyState, Kbd, Menu, Notice, Skeleton, Tooltip, cn } from "@/components/ui";
import { LoadingStatus } from "@/components/ui/Skeleton";
import { QUEUE_STATUS_LABEL } from "@/lib/fixtures/queue";
import { FILTERS, SORTS, isHeld, isLongWait, isSafety, type DeskFilter, type DeskSort } from "./desk-model";
import { HoldPill, StatusBadge, rowBadge } from "./StatusBadge";

export interface QueueRailProps {
  status: ResourceStatus;
  error?: DataError;
  onRetry: () => void;
  rows: DeskRow[];
  counts: Record<DeskFilter, number>;
  filter: DeskFilter;
  onFilter: (f: DeskFilter) => void;
  query: string;
  onQuery: (q: string) => void;
  sort: DeskSort;
  onSort: (s: DeskSort) => void;
  selectedId: string | null;
  /** Called before the row's link navigates, so the desk can prepare (for example leave an edit). */
  onOpen?: (id: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onShortcuts: () => void;
  onShowDone: () => void;
  onReset: () => void;
  /**
   * Group the clinician and urgent rows under one collapsible "With a clinician" row at the top (the "All" view).
   * They have nothing for the desk to send, so they start collapsed; the stop is still one click away.
   */
  safetyGroup?: { open: boolean; onToggle: () => void };
  /**
   * The row that should be the list's Tab stop (roving tabindex) even when another row is selected: the message a
   * phone user just came back from.
   */
  tabPreferId?: string | null;
  /**
   * Scroll the list to keep the selected row in view. Off for the desk's default open (no ?m= yet), so the queue
   * starts at its top; on for deep links and J or K.
   */
  followSelected?: boolean;
  className?: string;
}

/** Spoken waiting time: "2d 3h" reads "waiting 2 days 3 hours". */
function spokenWait(short: string): string {
  return (
    "waiting " +
    short
      .replace(/(\d+)d/, (_, n) => `${n} ${n === "1" ? "day" : "days"}`)
      .replace(/(\d+)h/, (_, n) => `${n} ${n === "1" ? "hour" : "hours"}`)
      .replace(/(\d+)m/, (_, n) => `${n} ${n === "1" ? "minute" : "minutes"}`)
  );
}

export function QueueRail({
  status,
  error,
  onRetry,
  rows,
  counts,
  filter,
  onFilter,
  query,
  onQuery,
  sort,
  onSort,
  selectedId,
  onOpen,
  searchRef,
  onShortcuts,
  onShowDone,
  onReset,
  safetyGroup,
  tabPreferId,
  followSelected = true,
  className,
}: QueueRailProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the open message in view as J and K move through the list. A short step scrolls just enough; a long jump
  // (the first open, or a deep link) brings the row near the top so the rows after it show too.
  useEffect(() => {
    if (!selectedId || !followSelected) return;
    // Scroll only the list (never the page): scrollIntoView would move every scrolling ancestor.
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-row="${selectedId}"]`);
    if (!list || !el || list.scrollHeight <= list.clientHeight) return;
    const lr = list.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const far = er.bottom < lr.top - lr.height / 2 || er.top > lr.bottom + lr.height / 2;
    if (far) list.scrollTop += er.top - lr.top - 8;
    else if (er.top < lr.top) list.scrollTop -= lr.top - er.top + 8;
    else if (er.bottom > lr.bottom) list.scrollTop += er.bottom - lr.bottom + 8;
  }, [selectedId, rows.length, safetyGroup?.open, followSelected]);

  // Focus follows the open message when J or K moves it while focus is on a row.
  useEffect(() => {
    const list = listRef.current;
    const active = document.activeElement;
    if (!selectedId || !list || !active || !list.contains(active) || !active.matches("a[data-queue-link]")) return;
    const link = list.querySelector<HTMLElement>(`[data-row="${selectedId}"] a`);
    if (link && active !== link) link.focus();
  }, [selectedId]);

  const loading = status === "loading" || status === "idle";
  const sortLabel = SORTS.find((s) => s.id === sort)?.label ?? "Priority";

  const grouped = safetyGroup ? rows.filter(isSafety) : [];
  const rest = safetyGroup ? rows.filter((r) => !isSafety(r)) : rows;
  // Rows the desk can act on, then the held ones (another message from the patient is with a clinician) in their own
  // labelled group at the bottom. The sort already puts held rows last, so J and K follow the same order.
  const groupHeld = filter !== "done";
  const actionable = groupHeld ? rest.filter((r) => !isHeld(r)) : rest;
  const held = groupHeld ? rest.filter(isHeld) : [];
  const shownRows = safetyGroup && !safetyGroup.open ? rest : rows;
  // Roving tabindex: the list is one Tab stop (the row just returned to, else the open message, else the first row);
  // arrow keys move inside it.
  const has = (id: string | null | undefined) => Boolean(id) && shownRows.some((r) => r.messageId === id);
  const tabRowId = has(tabPreferId) ? tabPreferId! : has(selectedId) ? selectedId : (shownRows[0]?.messageId ?? null);
  // Headings over the lists whenever more than one group shows, so no row reads as part of the group above it.
  const headed = grouped.length > 0 || held.length > 0;

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!t.matches("a[data-queue-link]") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const links = Array.from(listRef.current?.querySelectorAll<HTMLElement>("a[data-queue-link]") ?? []);
    const i = links.indexOf(t);
    let next = -1;
    if (e.key === "ArrowDown") next = Math.min(links.length - 1, i + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, i - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = links.length - 1;
    else return;
    e.preventDefault();
    links[next]?.focus();
  };

  return (
    <section
      data-tour="desk-queue"
      aria-labelledby="desk-queue-title"
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-line/70", className)}
    >
      <div className="flex flex-col gap-3 border-b border-line-cool px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="desk-queue-title" className="flex items-baseline gap-2 text-base font-semibold text-heading">
            Queue
            {!loading && status !== "error" && (
              <span className="text-sm font-medium text-muted tnum">{counts.all} open</span>
            )}
          </h2>
          <div className="flex items-center gap-1">
            <Menu
              label="Sort the queue"
              align="end"
              width={280}
              items={[
                { type: "label", id: "l", label: "Sort (urgent and clinician stay on top, held at the bottom)" },
                ...SORTS.map((s) => ({
                  type: "radio" as const,
                  id: s.id,
                  label: s.label,
                  description: s.description,
                  checked: s.id === sort,
                  onSelect: () => onSort(s.id),
                })),
              ]}
              trigger={({ open, ...p }) => (
                <button
                  {...p}
                  type="button"
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-inner px-2 text-xs font-medium text-heading transition-colors duration-150 hover:bg-navy-900/[0.06] active:bg-navy-900/10",
                    open && "bg-navy-900/[0.06]",
                  )}
                >
                  <ArrowDownUp aria-hidden size={14} className="text-muted-icon" />
                  <span className="sr-only">Sort: </span>
                  {sortLabel}
                </button>
              )}
            />
            <Tooltip content={<span className="inline-flex items-center gap-1.5">Keyboard shortcuts <Kbd tone="onDark">?</Kbd></span>} describe={false}>
              <button
                type="button"
                onClick={onShortcuts}
                aria-label="Keyboard shortcuts"
                className="hidden size-8 items-center justify-center rounded-inner text-muted-icon transition-colors duration-150 hover:bg-navy-900/[0.06] hover:text-heading active:bg-navy-900/10 lg:inline-flex"
              >
                <Keyboard aria-hidden size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        <SearchBox inputRef={searchRef} value={query} onChange={onQuery} />

        <FilterPills value={filter} counts={loading || status === "error" ? null : counts} onChange={onFilter} />
      </div>

      <div ref={listRef} onKeyDown={onListKey} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {status === "error" ? (
          <div className="p-2">
            <Notice
              tone="error"
              role="alert"
              title="The queue did not load"
              actions={
                <Button size="sm" variant="secondary" onClick={onRetry}>
                  Try again
                </Button>
              }
            >
              {error?.message ?? "Could not load the demo data. Check your connection and try again."}
            </Notice>
          </div>
        ) : loading ? (
          <RailSkeleton />
        ) : rows.length === 0 ? (
          <RailEmpty filter={filter} query={query} onClear={() => onQuery("")} onShowAll={() => onFilter("all")} onShowDone={onShowDone} onReset={onReset} doneCount={counts.done} />
        ) : (
          <>
            {safetyGroup && grouped.length > 0 && (
              <SafetyGroup rows={grouped} open={safetyGroup.open} onToggle={safetyGroup.onToggle}>
                <ul id="desk-safety-rows" aria-label="With a clinician" className="flex flex-col gap-0.5 pb-1">
                  {grouped.map((row) => (
                    <QueueItem
                      key={row.messageId}
                      row={row}
                      selected={row.messageId === selectedId}
                      tabbable={row.messageId === tabRowId}
                      onOpen={onOpen}
                    />
                  ))}
                </ul>
              </SafetyGroup>
            )}
            {actionable.length > 0 && (
              <div className={cn(held.length > 0 && "mb-1 border-b border-line-cool pb-1")}>
                {headed && (
                  <GroupHeading id="desk-rows-desk" count={actionable.length}>
                    For the desk
                  </GroupHeading>
                )}
                <ul
                  aria-labelledby={headed ? "desk-rows-desk" : undefined}
                  aria-label={headed ? undefined : "Messages"}
                  className="flex flex-col gap-0.5"
                >
                  {actionable.map((row) => (
                    <QueueItem
                      key={row.messageId}
                      row={row}
                      selected={row.messageId === selectedId}
                      tabbable={row.messageId === tabRowId}
                      onOpen={onOpen}
                    />
                  ))}
                </ul>
              </div>
            )}
            {held.length > 0 && (
              <div>
                <GroupHeading id="desk-rows-held" count={held.length} icon={ShieldAlert}>
                  Waiting on a clinician for this patient
                </GroupHeading>
                <p className="px-3 pb-1.5 text-xs text-muted">
                  Send stays off until the clinician has been in touch.
                </p>
                <ul aria-labelledby="desk-rows-held" className="flex flex-col gap-0.5">
                  {held.map((row) => (
                    <QueueItem
                      key={row.messageId}
                      row={row}
                      selected={row.messageId === selectedId}
                      tabbable={row.messageId === tabRowId}
                      onOpen={onOpen}
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

    </section>
  );
}

// ---------------------------------------------------------------------------

function SearchBox({
  inputRef,
  value,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <label htmlFor="desk-search" className="sr-only">
        Search the queue by first name, message id or words in the message
      </label>
      <Search aria-hidden size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-icon" />
      <input
        ref={inputRef}
        id="desk-search"
        type="search"
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder="Name, MSG id or text"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (value) onChange("");
            else e.currentTarget.blur();
            e.preventDefault();
          }
        }}
        className={cn(
          "h-10 w-full rounded-control border border-control-line bg-field pl-10 pr-10 text-sm text-ink placeholder:text-muted",
          "transition-[background-color,border-color,box-shadow] duration-150 ease-out-expo hover:border-muted-icon hover:bg-field-hover",
          "focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus focus-visible:shadow-[0_0_0_4px_rgb(47_111_214/0.16)]",
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear the search"
          className="absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-inner text-muted-icon transition-colors duration-150 hover:bg-navy-900/[0.06] hover:text-heading"
        >
          <X aria-hidden size={15} />
        </button>
      ) : (
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 lg:inline-flex">
          <Kbd>/</Kbd>
        </span>
      )}
    </div>
  );
}

/** The fade at an edge that has more pills beyond it: the pills fade out just before that edge's arrow button. */
function edgeFade(left: boolean, right: boolean): string | undefined {
  if (!left && !right) return undefined;
  const from = left ? "transparent 2.75rem, black 4.5rem" : "black 0";
  const to = right ? "black calc(100% - 4.5rem), transparent calc(100% - 2.75rem)" : "black 100%";
  return `linear-gradient(to right, ${from}, ${to})`;
}

/**
 * Filter pills: a radio group on one row that scrolls sideways, so the queue keeps its rows. When pills are cut off,
 * the edge fades and an arrow button there scrolls to show them. Arrow keys move between the pills too, and the chosen
 * pill is kept in view.
 */
function FilterPills({
  value,
  counts,
  onChange,
}: {
  value: DeskFilter;
  counts: Record<DeskFilter, number> | null;
  onChange: (f: DeskFilter) => void;
}) {
  const refs = useRef(new Map<DeskFilter, HTMLButtonElement | null>());
  const rowRef = useRef<HTMLDivElement>(null);
  // Which edges have pills beyond them. Measured on scroll and whenever the row or a pill changes size (the counts
  // arrive after the first paint); the observer's first call does the first measure.
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const left = row.scrollLeft > 1;
      const right = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    };
    row.addEventListener("scroll", measure, { passive: true });
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(row);
      for (const el of refs.current.values()) if (el) ro.observe(el);
    } else {
      window.requestAnimationFrame(measure);
    }
    return () => {
      row.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, []);
  // Keep the chosen pill in view on the scrolling row (scrolls the row only, never the page).
  useEffect(() => {
    const row = rowRef.current;
    const el = refs.current.get(value);
    if (!row || !el || row.scrollWidth <= row.clientWidth) return;
    const r = row.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    // Clear of the arrow buttons as well as the edge.
    if (b.left < r.left + 44) row.scrollLeft -= r.left + 44 - b.left;
    else if (b.right > r.right - 44) row.scrollLeft += b.right - (r.right - 44);
  }, [value]);
  const page = (dir: 1 | -1) => {
    const row = rowRef.current;
    if (!row) return;
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* keep the smooth scroll */
    }
    row.scrollBy({ left: dir * Math.max(120, row.clientWidth * 0.75), behavior: reduced ? "auto" : "smooth" });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = FILTERS.findIndex((f) => f.id === value);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % FILTERS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + FILTERS.length) % FILTERS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = FILTERS.length - 1;
    if (next == null) return;
    e.preventDefault();
    const id = FILTERS[next].id;
    onChange(id);
    refs.current.get(id)?.focus();
  };
  const fade = edgeFade(more.left, more.right);
  return (
    <div className="relative">
      <div
        ref={rowRef}
        role="radiogroup"
        aria-label="Show"
        onKeyDown={onKeyDown}
        style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
        className="-mx-4 -my-1 flex gap-1.5 overflow-x-auto overscroll-x-contain px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {FILTERS.map((f) => {
          const checked = f.id === value;
          return (
            <Tooltip key={f.id} content={f.description} delay={600}>
              <button
                ref={(el) => {
                  refs.current.set(f.id, el);
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => onChange(f.id)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 text-xs font-medium",
                  "transition-[background-color,border-color,color] duration-150 ease-out-expo active:scale-[0.98]",
                  checked
                    ? "border-navy-900 bg-navy-900 text-white"
                    : "border-line-strong bg-surface text-heading hover:border-navy-300 hover:bg-field active:bg-field-hover",
                )}
              >
                {f.label}
                {counts && f.id !== "all" && (
                  <span className={cn("text-2xs font-semibold tnum", checked ? "text-on-navy-muted" : "text-muted")}>
                    {counts[f.id]}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>
      {/* For the pointer: the arrow keys already move through every pill, so these stay out of the Tab order. */}
      {more.left && <PillsArrow dir={-1} onClick={() => page(-1)} />}
      {more.right && <PillsArrow dir={1} onClick={() => page(1)} />}
    </div>
  );
}

function PillsArrow({ dir, onClick }: { dir: 1 | -1; onClick: () => void }) {
  const Icon = dir === 1 ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      title={dir === 1 ? "More filters" : "Back to the first filters"}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 inline-flex size-8 -translate-y-1/2 animate-rise-in items-center justify-center rounded-pill bg-surface text-heading shadow-raised ring-1 ring-line-strong",
        "transition-[background-color,transform] duration-150 ease-out-expo hover:bg-field active:scale-95",
        dir === 1 ? "-right-1" : "-left-1",
      )}
    >
      <Icon aria-hidden size={16} strokeWidth={2.25} />
    </button>
  );
}

const CHANNEL = {
  email: { icon: Mail, label: "Email" },
  chat: { icon: MessageCircle, label: "Chat" },
} as const;

/** A small heading over one group of rows, with its count. */
function GroupHeading({
  id,
  count,
  icon: Icon,
  children,
}: {
  id: string;
  count: number;
  icon?: typeof ShieldAlert;
  children: ReactNode;
}) {
  return (
    <h3 id={id} className="flex items-center gap-2 px-3 pb-1 pt-2 text-xs font-semibold text-heading">
      {Icon && <Icon aria-hidden size={14} className="shrink-0 text-muted-icon" />}
      <span>{children}</span>
      <span className="font-medium text-muted tnum">
        <span className="sr-only">, </span>
        {count}
      </span>
    </h3>
  );
}

/** The clinician and urgent rows, folded into one row that opens in place. */
function SafetyGroup({
  rows,
  open,
  onToggle,
  children,
}: {
  rows: DeskRow[];
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const urgent = rows.filter((r) => r.status === "urgent").length;
  return (
    <div className="mb-1 border-b border-line-cool pb-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? "desk-safety-rows" : undefined}
        onClick={onToggle}
        className="flex w-full items-start gap-2 rounded-control px-3 py-2.5 text-left transition-colors duration-150 ease-out-expo hover:bg-field/70 active:bg-field focus-visible:outline-offset-[-2px]"
      >
        <Stethoscope aria-hidden size={15} className="mt-0.5 shrink-0 text-clinician-fg" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-heading">With a clinician</span>
            <span className="text-xs font-medium text-muted tnum">
              {rows.length}
              {urgent > 0 ? `, ${urgent} urgent` : ""}
            </span>
          </span>
          {/* One line below 1280px, where the rail is narrow: the explainer stays for screen readers. */}
          <span className="text-xs text-muted max-xl:sr-only">Stopped by the safety rules. Nothing to send from the desk.</span>
        </span>
        <ChevronDown
          aria-hidden
          size={16}
          className={cn("mt-0.5 shrink-0 text-muted-icon transition-transform duration-200 ease-out-expo", open && "rotate-180")}
        />
      </button>
      {open && children}
    </div>
  );
}

function QueueItem({
  row,
  selected,
  tabbable,
  onOpen,
}: {
  row: DeskRow;
  selected: boolean;
  /** The one row of the list that Tab reaches (roving tabindex). */
  tabbable: boolean;
  onOpen?: (id: string) => void;
}) {
  const ch = CHANNEL[row.channel];
  const ChannelIcon = ch.icon;
  const wait = waitingTime(row.receivedAt);
  const long = isLongWait(row.receivedAt);
  const badge = rowBadge(row);
  const line = row.subject ?? row.preview;
  return (
    <li data-row={row.messageId}>
      <Link
        href={`/desk/?m=${row.messageId}`}
        prefetch={false}
        scroll={false}
        aria-current={selected ? "true" : undefined}
        data-queue-link
        tabIndex={tabbable ? 0 : -1}
        onPointerEnter={() => prefetchCase(row.messageId)}
        onFocus={() => prefetchCase(row.messageId)}
        onClick={() => onOpen?.(row.messageId)}
        className={cn(
          "group relative flex flex-col gap-1.5 rounded-control px-3 py-2.5 transition-colors duration-150 ease-out-expo",
          "focus-visible:outline-offset-[-2px]",
          selected
            ? "bg-selected-bg ring-1 ring-inset ring-navy-900/25"
            : "hover:bg-field/70 active:bg-field",
        )}
      >
        <span className="flex items-center gap-2">
          <ChannelIcon aria-hidden size={15} className="shrink-0 text-muted-icon" />
          <span className="sr-only">{ch.label} from</span>
          <span className="min-w-0 truncate text-sm font-semibold text-heading">{row.firstName}</span>
          <span className="shrink-0 text-xs font-medium text-muted">
            <span aria-hidden>{row.country}</span>
            <span className="sr-only">, {COUNTRY_LABEL[row.country]}.</span>
          </span>
          <span
            className={cn("ml-auto shrink-0 text-xs tnum", long ? "font-semibold text-heading" : "text-muted")}
            aria-label={spokenWait(wait)}
          >
            {wait}
          </span>
        </span>
        <span className={cn("line-clamp-1 text-sm", selected ? "text-heading" : "text-ink")}>{line}</span>
        {/* One chip says what the row needs. A safety row adds why it stopped, and the hold when orders are held. */}
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge meta={badge} />
          {isSafety(row) && row.category && !repeatsStatus(row.category, badge.label) && <Chip category={row.category} />}
          {row.holdActive && <HoldPill />}
        </span>
      </Link>
    </li>
  );
}

/** "Wants a person" beside "Write the reply" says the same thing twice: the status already covers it. */
export function repeatsStatus(category: string, statusLabel: string): boolean {
  return category === "wants_human" && statusLabel === QUEUE_STATUS_LABEL.needs_person;
}

function RailSkeleton() {
  return (
    <div className="flex flex-col gap-0.5">
      <LoadingStatus label="Loading the queue" />
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 px-3 py-3">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="ml-auto h-3 w-10" />
          </div>
          <Skeleton className={cn("h-3.5", i % 2 ? "w-4/5" : "w-full")} />
          <div className="flex gap-1.5">
            <Skeleton rounded="pill" className="h-6 w-24" />
            <Skeleton rounded="pill" className="h-6 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RailEmpty({
  filter,
  query,
  onClear,
  onShowAll,
  onShowDone,
  onReset,
  doneCount,
}: {
  filter: DeskFilter;
  query: string;
  onClear: () => void;
  onShowAll: () => void;
  onShowDone: () => void;
  onReset: () => void;
  doneCount: number;
}) {
  if (query.trim()) {
    return (
      <EmptyState icon={SearchX} title={`No messages match "${query.trim()}"`} size="sm">
        <p>Search by first name (Aisha), message id (MSG-0026) or words in the message.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={onClear}>
            Clear the search
          </Button>
          {filter !== "all" && (
            <Button size="sm" variant="ghost" onClick={onShowAll}>
              Search all open messages
            </Button>
          )}
        </div>
      </EmptyState>
    );
  }
  if (filter === "all") {
    return (
      <EmptyState icon={CircleCheckBig} title="All caught up" size="sm">
        <p>
          Every message has a reply or an owner. New messages land here with their check trail already run, so you only
          review and send.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {doneCount > 0 && (
            <Button size="sm" variant="secondary" onClick={onShowDone}>
              See what was done
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onReset}>
            Reset the demo
          </Button>
        </div>
      </EmptyState>
    );
  }
  const copy: Record<Exclude<DeskFilter, "all">, { title: string; body: string }> = {
    person: {
      title: "No replies to write right now",
      body: "Messages land here when there is no AI draft: someone asked for a person, a complaint, low confidence, or a check with the clinician first.",
    },
    ready: {
      title: "No drafts waiting",
      body: "Routine messages with a checked draft land here. Review one, then press Send or Ctrl+Enter.",
    },
    safety: {
      title: "No clinical or urgent messages",
      body: "Anything the safety rules stop shows here, pinned to the top, with no AI reply. A clinician answers those.",
    },
    done: {
      title: "Nothing done yet",
      body: "Replies you send and messages you escalate collect here. Each can be undone from its toast.",
    },
  };
  const c = copy[filter];
  return (
    <EmptyState icon={Inbox} title={c.title} size="sm">
      <p>{c.body}</p>
      <div className="mt-4 flex justify-center">
        <Button size="sm" variant="secondary" onClick={onShowAll}>
          Show all open messages
        </Button>
      </div>
    </EmptyState>
  );
}
