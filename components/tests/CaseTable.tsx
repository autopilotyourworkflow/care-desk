"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Search, SearchX, X } from "lucide-react";
import type { EvalCase } from "@/lib/types";
import type { PublicEvalReport } from "@/lib/client/types";
import { Button, Card, CardHeader, Chip, Disclosure, EmptyState, Field, Notice, RiskBadge, SegmentedControl, TextInput, cn, isTypingTarget } from "@/components/ui";
import { useShell } from "@/components/shell";
import { COUNTRY_SHORT, formatNumber } from "@/lib/format";
import { caseOutcome, FILTER_HINT, FILTER_LABEL, laterDeathReport, matchesFilter, matchesQuery, OUTCOME_KEY, type CaseFilter } from "./model";
import { CaseDetail } from "./CaseDetail";

const PAGE = 8;
const FILTERS: CaseFilter[] = ["all", "safety", "death_later", "tricky", "redteam", "queue", "any"];
/** Shown only when the run has such cases, so an empty chip never sits in the row. */
const OPTIONAL: CaseFilter[] = ["death_later"];

export interface CaseTableProps {
  report: PublicEvalReport;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  /** Bumped when another part of the page asks to show openId (a tricky case, a deep link): scroll it into view. */
  revealToken: number;
  /** A ?case= id that is not in the test set. */
  missingId: string | null;
  onDismissMissing: () => void;
  /** Open another case and scroll to it (a case detail's link to the message that caused a patient-level lock). */
  onReveal: (id: string) => void;
}

/** The parts of a key press the "/" shortcut looks at. */
export interface ShortcutKey {
  key: string;
  defaultPrevented: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Whether "/" should move focus to the case search: only a plain "/" (Shift is fine, some layouts need it), with
 * one-key shortcuts switched on, nothing else having handled the key, focus outside a field, and no dialog or menu open.
 */
export function searchShortcutApplies(
  e: ShortcutKey,
  ctx: { singleKeys: boolean; typing: boolean; overlayOpen: boolean },
): boolean {
  if (e.key !== "/") return false;
  if (!ctx.singleKeys || e.defaultPrevented) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return !ctx.typing && !ctx.overlayOpen;
}

/** An open modal dialog, a menu or another non-tooltip popover owns the keyboard while it shows. */
function overlayIsOpen(): boolean {
  if (document.querySelector("dialog[open], [aria-modal='true']")) return true;
  try {
    return Boolean(document.querySelector("[popover]:popover-open:not([role='tooltip']):not([aria-hidden='true'])"));
  } catch {
    return false; // a browser without popovers has none open
  }
}

const rowDomId = (id: string) => `test-case-${id}`;
const detailDomId = (id: string) => `test-case-${id}-detail`;

/** Every test case: filter, search, and open one inline to see expected against what happened, with its trail. */
export function CaseTable({ report, openId, onOpenChange, revealToken, missingId, onDismissMissing, onReveal }: CaseTableProps) {
  const [filter, setFilter] = useState<CaseFilter>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const searchRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const out = {} as Record<CaseFilter, number>;
    for (const f of FILTERS) out[f] = report.cases.filter((c) => matchesFilter(c, f, report.caseMeta[c.messageId])).length;
    return out;
  }, [report]);

  const rows = useMemo(
    () =>
      report.cases.filter(
        (c) => matchesFilter(c, filter, report.caseMeta[c.messageId]) && matchesQuery(c, report.caseMeta[c.messageId], query),
      ),
    [report, filter, query],
  );

  // A reveal request from elsewhere on the page (a tricky case, a deep link). During render, make sure the case is in
  // the list and on a shown page; after the commit, scroll to it.
  const [seenToken, setSeenToken] = useState(0);
  if (revealToken !== seenToken) {
    setSeenToken(revealToken);
    if (openId) {
      let list = rows;
      if (!rows.some((c) => c.messageId === openId)) {
        setFilter("all");
        setQuery("");
        list = report.cases;
      }
      const idx = list.findIndex((c) => c.messageId === openId);
      if (idx >= limit) setLimit(Math.ceil((idx + 1) / PAGE) * PAGE);
    }
  }
  const openRef = useRef(openId);
  useEffect(() => {
    openRef.current = openId;
  }, [openId]);
  useEffect(() => {
    const id = openRef.current;
    if (!seenToken || !id) return;
    const raf = window.requestAnimationFrame(() => {
      const el = document.getElementById(rowDomId(id));
      if (!el) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      el.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [seenToken]);

  // "/" focuses the search box, as in most tools. It is a one-key shortcut, so it obeys the switch in the Keyboard
  // shortcuts panel (WCAG 2.1.4) and stands aside for fields, open dialogs and menus, and keys already handled.
  const { singleKeys } = useShell();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ok = searchShortcutApplies(e, {
        singleKeys,
        typing: isTypingTarget(e.target),
        overlayOpen: overlayIsOpen(),
      });
      if (!ok) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [singleKeys]);

  const changeFilter = (f: CaseFilter) => {
    setFilter(f);
    setLimit(PAGE);
  };
  const changeQuery = (q: string) => {
    setQuery(q);
    setLimit(PAGE);
  };
  const clearAll = () => {
    setFilter("all");
    setQuery("");
    setLimit(PAGE);
    searchRef.current?.focus();
  };

  // The result key lists only the labels this run actually uses.
  const key = useMemo(() => {
    const used = new Set(report.cases.map((c) => caseOutcome(c).kind));
    return OUTCOME_KEY.filter((k) => used.has(k.kind));
  }, [report]);

  const shown = rows.slice(0, limit);
  const left = rows.length - shown.length;
  const summary =
    rows.length === report.cases.length
      ? `Showing ${shown.length} of ${formatNumber(rows.length)} cases`
      : `${formatNumber(rows.length)} of ${formatNumber(report.cases.length)} cases match${shown.length < rows.length ? `, showing ${shown.length}` : ""}`;

  return (
    <Card as="section" aria-labelledby="tests-cases-title" padding="none">
      <div className="p-4 pb-0 sm:p-6 sm:pb-0">
        <CardHeader
          title={<span id="tests-cases-title">Every test case</span>}
          description="Open a case to see the message, what was expected, what happened and its check trail."
        />

        {missingId && (
          <Notice
            tone="warning"
            title="That test case isn't in the set"
            className="mb-4"
            actions={
              <Button size="sm" variant="secondary" onClick={onDismissMissing}>
                Show all cases
              </Button>
            }
          >
            There is no test case called {missingId}. The link may be mistyped or from an older version of the test set.
          </Notice>
        )}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
            <SegmentedControl
              label="Show test cases"
              value={filter}
              onChange={changeFilter}
              items={FILTERS.filter((f) => counts[f] > 0 || !OPTIONAL.includes(f) || f === filter).map((f) => ({
                id: f,
                label: FILTER_LABEL[f],
                count: counts[f],
              }))}
            />
          </div>
          <Field label="Search test cases" hideLabel className="w-full lg:max-w-sm">
            <div className="relative">
              <Search aria-hidden size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-icon" />
              <TextInput
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => changeQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.preventDefault();
                    changeQuery("");
                  }
                }}
                placeholder="Search names, words or numbers"
                className="pl-10! pr-10! [&::-webkit-search-cancel-button]:hidden"
                autoComplete="off"
                spellCheck={false}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear the search"
                  onClick={() => {
                    changeQuery("");
                    searchRef.current?.focus();
                  }}
                  className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-inner text-muted-icon transition-colors duration-150 hover:bg-navy-900/[0.06] hover:text-heading active:bg-navy-900/10"
                >
                  <X aria-hidden size={16} />
                </button>
              )}
            </div>
          </Field>
        </div>

        {/* What each result label means: folded, since each row's label already reads plainly. */}
        {key.length > 1 && (
          <Disclosure summary="What the results mean" className="mt-3">
            <dl aria-label="What the results mean" className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1 text-xs text-muted">
              {key.map((k) => (
                <div key={k.kind} className="flex items-center gap-1.5">
                  <dt>
                    <Chip tone={k.tone}>{k.label}</Chip>
                  </dt>
                  <dd>{k.short}</dd>
                </div>
              ))}
            </dl>
          </Disclosure>
        )}

        <p role="status" className="mt-3 text-xs text-muted tnum">
          {FILTER_HINT[filter] && <>{FILTER_HINT[filter]} </>}
          {summary}.
        </p>
      </div>

      <div className="mt-3">
        {rows.length === 0 ? (
          <div className="border-t border-line-cool">
            <EmptyState
              icon={SearchX}
              title={query ? `No cases match “${query.trim()}”` : "No cases in this view"}
              actions={
                <Button variant="secondary" size="sm" onClick={clearAll}>
                  Show all cases
                </Button>
              }
            >
              {filter === "any" && !query
                ? "Every case was handled exactly as its label expected."
                : filter === "queue" && !query
                  ? "Every case reached the queue its label expected."
                  : "Try a first name, a word from the message, a type such as billing, or a number such as 0158."}
            </EmptyState>
          </div>
        ) : (
          <>
            <div
              aria-hidden
              className="hidden border-t border-line-cool px-6 py-2 text-xs font-medium text-muted md:grid md:grid-cols-[6.5rem_minmax(0,1fr)_9.5rem_9.5rem_9.5rem_1.25rem] md:gap-4"
            >
              <span>Case</span>
              <span>Message</span>
              <span>Expected</span>
              <span>Got</span>
              <span>Result</span>
              <span />
            </div>
            <ul>
              {shown.map((c) => (
                <CaseRow
                  key={c.messageId}
                  c={c}
                  report={report}
                  onReveal={onReveal}
                  open={openId === c.messageId}
                  onToggle={() => onOpenChange(openId === c.messageId ? null : c.messageId)}
                  onClose={() => {
                    onOpenChange(null);
                    document.getElementById(rowDomId(c.messageId))?.querySelector<HTMLButtonElement>("button")?.focus();
                  }}
                />
              ))}
            </ul>
            {left > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2 border-t border-line-cool p-4">
                <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
                  Show {Math.min(PAGE, left)} more
                </Button>
                <Button variant="ghost" onClick={() => setLimit(rows.length)}>
                  Show all {formatNumber(rows.length)}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function CaseRow({
  c,
  report,
  onReveal,
  open,
  onToggle,
  onClose,
}: {
  c: EvalCase;
  report: PublicEvalReport;
  onReveal: (id: string) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const meta = report.caseMeta[c.messageId];
  const outcome = caseOutcome(c);
  const text = meta?.subject ? meta.subject : meta?.preview;
  // A routine question that went urgent only because a later message reported the patient's death: say so in the row,
  // or an order or receipt question marked urgent reads as a mistake.
  const deathBy = laterDeathReport(c);
  const tag = deathBy ? (
    <Chip>{FILTER_LABEL.death_later}</Chip>
  ) : meta?.testOnly ? (
    <Chip tone="outline">{FILTER_LABEL.redteam}</Chip>
  ) : c.expected.tricky ? (
    <Chip>Tricky</Chip>
  ) : null;
  return (
    <li id={rowDomId(c.messageId)} className="scroll-mt-2 border-t border-line-cool">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? detailDomId(c.messageId) : undefined}
        onClick={onToggle}
        className={cn(
          "group grid w-full gap-x-4 gap-y-2 px-4 py-3.5 text-left transition-colors duration-150 sm:px-6",
          "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[6.5rem_minmax(0,1fr)_9.5rem_9.5rem_9.5rem_1.25rem] md:items-center",
          "focus-visible:outline-offset-[-2px]",
          open ? "bg-selected-bg" : "hover:bg-field/60 active:bg-field",
        )}
      >
        {/* Case id, patient and tags */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:flex-col md:items-start md:gap-0.5">
          <span className="text-sm font-semibold text-heading tnum">{c.messageId}</span>
          <span className="text-xs text-muted">{meta ? `${meta.firstName}, ${COUNTRY_SHORT[meta.country]}` : ""}</span>
          {tag && <span className="md:hidden">{tag}</span>}
        </span>

        {/* Small screens: the result and the chevron share the top line. Wide: the result has its own column. */}
        <span className="col-start-2 row-start-1 flex items-center gap-2 justify-self-end md:col-start-5 md:justify-self-start">
          <span className="sr-only">Result: </span>
          <Chip tone={outcome.tone}>{outcome.label}</Chip>
          <ChevronDown
            aria-hidden
            size={18}
            className={cn(
              "shrink-0 text-muted-icon transition-transform duration-200 ease-out-expo group-hover:text-heading md:hidden",
              open && "rotate-180",
            )}
          />
        </span>
        <ChevronDown
          aria-hidden
          size={18}
          className={cn(
            "hidden text-muted-icon transition-transform duration-200 ease-out-expo group-hover:text-heading md:col-start-6 md:row-start-1 md:block",
            open && "rotate-180",
          )}
        />

        {/* Message */}
        <span className="col-span-2 min-w-0 md:col-span-1 md:col-start-2 md:row-start-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("min-w-0 truncate text-sm text-ink", meta?.subject && "font-medium text-heading")}>{text}</span>
            {tag && <span className="hidden shrink-0 md:inline-flex">{tag}</span>}
          </span>
          {deathBy ? (
            <span className="mt-0.5 block text-xs text-ink">
              A later message, <span className="tnum">{deathBy}</span>, reports that this patient has died, so nothing may
              be sent to them.
            </span>
          ) : (
            meta?.subject && <span className="mt-0.5 block truncate text-xs text-muted">{meta.preview}</span>
          )}
        </span>

        {/* Expected and got */}
        <span className="col-span-2 flex items-center gap-1.5 md:contents">
          <span className="md:col-start-3 md:row-start-1">
            <span className="sr-only">Expected: </span>
            <RiskBadge route={c.expected.expectedRoute} />
          </span>
          <ArrowRight aria-hidden size={14} className="shrink-0 text-muted-icon md:hidden" />
          <span className="md:col-start-4 md:row-start-1">
            <span className="sr-only">, got: </span>
            <RiskBadge route={c.got.route} />
          </span>
        </span>
      </button>
      {open && (
        <CaseDetail
          c={c}
          id={detailDomId(c.messageId)}
          onClose={onClose}
          caseOpener={(id) => (report.cases.some((x) => x.messageId === id) ? () => onReveal(id) : undefined)}
        />
      )}
    </li>
  );
}
