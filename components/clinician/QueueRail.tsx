"use client";

import Link from "next/link";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { CircleCheck, Inbox, Mail, MessageCircle, Phone, PhoneMissed, RotateCcw } from "lucide-react";
import { Button, Chip, EmptyState, Notice, Skeleton, cn } from "@/components/ui";
import { HoldPill } from "@/components/desk/StatusBadge";
import { LoadingStatus } from "@/components/ui/Skeleton";
import { COUNTRY_LABEL, minutesSince, waitingTime } from "@/lib/format";
import { prefetchCase, type DataError } from "@/lib/client/data";
import type { DeskRow } from "@/lib/client/queue";
import { escalatedAt, GROUP_LABEL, groupFor, isHandled, nowFor, spokeToPatient, type ClinicianGroup } from "./model";
import { ReasonChip } from "./ReasonChip";

export type QueueFilter = "todo" | "handled" | "all";

export interface QueueRailProps {
  status: "idle" | "loading" | "ready" | "error";
  error?: DataError;
  onRetry: () => void;
  /** Every clinician row, in queue order. */
  rows: DeskRow[];
  /** The rows the filter shows, in queue order. */
  visible: DeskRow[];
  filter: QueueFilter;
  onFilter: (f: QueueFilter) => void;
  selectedId: string | null;
  className?: string;
}

const GROUPS: ClinicianGroup[] = ["urgent", "clinician", "agent"];

const FILTERS: { id: QueueFilter; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "handled", label: "Handled" },
  { id: "all", label: "All" },
];

/** Spoken waiting time: "2d 3h" reads "escalated 2 days 3 hours ago". */
function spokenWait(short: string): string {
  return (
    "escalated " +
    short
      .replace(/(\d+)d/, (_, n) => `${n} ${n === "1" ? "day" : "days"}`)
      .replace(/(\d+)h/, (_, n) => `${n} ${n === "1" ? "hour" : "hours"}`)
      .replace(/(\d+)m/, (_, n) => `${n} ${n === "1" ? "minute" : "minutes"}`) +
    " ago"
  );
}

/** The escalation list: urgent first, then clinician review, then agent escalations; oldest first in each. */
export function QueueRail({
  status,
  error,
  onRetry,
  rows,
  visible,
  filter,
  onFilter,
  selectedId,
  className,
}: QueueRailProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const handledCount = rows.filter(isHandled).length;
  const counts: Record<QueueFilter, number> = {
    todo: rows.length - handledCount,
    handled: handledCount,
    all: rows.length,
  };
  const ready = status === "ready";
  // Roving tabindex, like the desk: the list is one Tab stop (the open escalation, else the first row).
  const tabRowId = visible.some((r) => r.messageId === selectedId) ? selectedId : (visible[0]?.messageId ?? null);
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (!t.matches("a[data-row-id]") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const links = Array.from(listRef.current?.querySelectorAll<HTMLElement>("a[data-row-id]") ?? []);
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

  // Keep the open escalation in view, on a deep link and as J and K move through the list.
  useEffect(() => {
    if (!selectedId || !ready) return;
    // Scroll only the list (never the page): scrollIntoView would move every scrolling ancestor.
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-row-id="${selectedId}"]`);
    if (!list || !el || list.scrollHeight <= list.clientHeight) return;
    const lr = list.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top < lr.top) list.scrollTop -= lr.top - er.top + 8;
    else if (er.bottom > lr.bottom) list.scrollTop += er.bottom - lr.bottom + 8;
  }, [selectedId, ready, visible.length]);

  return (
    <section
      aria-labelledby="clinician-rail-title"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-line/70",
        className,
      )}
    >
      <div className="flex flex-col gap-3 border-b border-line-cool px-4 pb-3 pt-4">
        <h2 id="clinician-rail-title" className="flex items-baseline gap-2 text-base font-semibold text-heading">
          Escalations
          {ready && <span className="text-sm font-medium text-muted tnum">{counts.todo} to do</span>}
        </h2>
        <FilterPills value={filter} counts={ready ? counts : null} onChange={onFilter} />
      </div>

      <div ref={listRef} className="relative min-h-0 flex-1 overscroll-contain px-2 py-2 lg:overflow-y-auto">
        {status === "error" ? (
          <div className="p-2">
            <Notice
              tone="error"
              role="alert"
              title="The queue did not load"
              actions={
                <Button size="sm" variant="secondary" leadingIcon={RotateCcw} onClick={onRetry}>
                  Try again
                </Button>
              }
            >
              {error?.message ?? "Could not load the demo data. Check your connection and try again."}
            </Notice>
          </div>
        ) : !ready ? (
          <RailSkeleton />
        ) : visible.length === 0 ? (
          <EmptyRail filter={filter} onFilter={onFilter} total={rows.length} />
        ) : (
          <nav aria-label="Escalations" onKeyDown={onListKey}>
            {GROUPS.map((g) => {
              const items = visible.filter((r) => groupFor(r) === g);
              if (!items.length) return null;
              return (
                <section key={g} aria-labelledby={`group-${g}`} className="mb-2 last:mb-0">
                  <h3
                    id={`group-${g}`}
                    className="flex items-baseline gap-2 px-3 pb-1 pt-2 text-xs font-semibold text-heading"
                  >
                    {GROUP_LABEL[g]}
                    <span className="font-medium text-muted tnum">{items.length}</span>
                  </h3>
                  <ul className="flex flex-col gap-0.5">
                    {items.map((row) => (
                      <li key={row.messageId}>
                        <RailRow
                          row={row}
                          selected={row.messageId === selectedId}
                          tabbable={row.messageId === tabRowId}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </nav>
        )}
      </div>

    </section>
  );
}

/** Filter pills, the same as the desk's: a radio group. Arrow keys move between them. */
function FilterPills({
  value,
  counts,
  onChange,
}: {
  value: QueueFilter;
  counts: Record<QueueFilter, number> | null;
  onChange: (f: QueueFilter) => void;
}) {
  const refs = useRef(new Map<QueueFilter, HTMLButtonElement | null>());
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
  return (
    <div role="radiogroup" aria-label="Show escalations" className="flex flex-wrap gap-1.5" onKeyDown={onKeyDown}>
      {FILTERS.map((f) => {
        const checked = f.id === value;
        return (
          <button
            key={f.id}
            ref={(el) => {
              refs.current.set(f.id, el);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(f.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 text-xs font-medium",
              "transition-[background-color,border-color,color] duration-150 ease-out-expo active:scale-[0.98]",
              checked
                ? "border-navy-900 bg-navy-900 text-white"
                : "border-line-strong bg-surface text-heading hover:border-navy-300 hover:bg-field active:bg-field-hover",
            )}
          >
            {f.label}
            {counts && (
              <span className={cn("text-2xs font-semibold tnum", checked ? "text-on-navy-muted" : "text-muted")}>
                {counts[f.id]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const CHANNEL = {
  email: { icon: Mail, label: "Email" },
  chat: { icon: MessageCircle, label: "Chat" },
} as const;

function RailRow({ row, selected, tabbable }: { row: DeskRow; selected: boolean; tabbable: boolean }) {
  const at = escalatedAt(row);
  const now = nowFor(row);
  const wait = waitingTime(at, now);
  const long = minutesSince(at, now) >= 24 * 60;
  const handled = isHandled(row);
  const rec = row.clinicianRecord;
  const line = row.subject ?? row.preview;
  const ch = CHANNEL[row.channel];
  const ChannelIcon = ch.icon;
  return (
    <Link
      href={`/clinician/?m=${row.messageId}`}
      prefetch={false}
      scroll={false}
      data-row-id={row.messageId}
      aria-current={selected ? "true" : undefined}
      tabIndex={tabbable ? 0 : -1}
      onPointerEnter={() => prefetchCase(row.messageId)}
      onFocus={() => prefetchCase(row.messageId)}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-control px-3 py-2.5 transition-colors duration-150 ease-out-expo",
        "focus-visible:outline-offset-[-2px]",
        selected ? "bg-selected-bg ring-1 ring-inset ring-navy-900/25" : "hover:bg-field/70 active:bg-field",
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
      <span className={cn("line-clamp-1 text-sm", selected ? "text-heading" : row.subject ? "text-ink" : "text-muted")}>
        {line}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <ReasonChip row={row} />
        {row.holdActive && <HoldPill />}
        {handled && row.clinicianReplied && (
          <Chip tone="success" icon={CircleCheck}>
            Replied
          </Chip>
        )}
        {!row.clinicianReplied && spokeToPatient(row) && (
          <Chip tone="success" icon={Phone}>
            Called
          </Chip>
        )}
        {!row.clinicianReplied && !spokeToPatient(row) && (rec?.calls.length ?? 0) > 0 && (
          <Chip tone="outline" icon={PhoneMissed}>
            No answer
          </Chip>
        )}
        {row.cleared && <Chip tone="outline">False alarm</Chip>}
      </span>
    </Link>
  );
}

function RailSkeleton() {
  return (
    <div className="flex flex-col gap-0.5">
      <LoadingStatus label="Loading the clinician queue" />
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
            <Skeleton rounded="pill" className="h-6 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyRail({
  filter,
  onFilter,
  total,
}: {
  filter: QueueFilter;
  onFilter: (f: QueueFilter) => void;
  total: number;
}) {
  if (filter === "handled") {
    return (
      <EmptyState icon={Inbox} title="Nothing handled yet" size="sm">
        When you reply to a patient, log a call or mark a false alarm, the message moves here with a record of who did
        what.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={CircleCheck}
      title="All escalations handled"
      size="sm"
      actions={
        total > 0 ? (
          <Button size="sm" variant="secondary" onClick={() => onFilter("handled")}>
            Show handled
          </Button>
        ) : undefined
      }
    >
      New clinical questions, side effects and urgent messages land here the moment the safety rules stop them, with the
      patient&apos;s orders already on hold when it is urgent.
    </EmptyState>
  );
}
