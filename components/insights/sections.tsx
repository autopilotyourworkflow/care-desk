"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, CircleCheck, CirclePause, Clock, Lock, ShieldCheck, Stethoscope } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Disclosure,
  Divider,
  Photo,
  RiskBadge,
  SegmentedControl,
  ROUTE_TO_RISK,
  SAMPLE_STAND_IN,
} from "@/components/ui";
import { cn } from "@/components/ui/cn";
import type { Category, RoutineCategory } from "@/lib/types";
import type { PublicEvalReport, PublicMeta } from "@/lib/client/types";
import type { Decision } from "@/lib/client/session-state";
import {
  categoryLabel,
  formatCalendarDate,
  formatMinutes,
  formatNumber,
  formatPercent,
  formatUsd,
  modelLabel,
  plural,
  ROUTE_LABEL,
} from "@/lib/format";
import { DEFAULT_LIMITS } from "@/worker/limits";
import { DataTable, Legend, PairedColumns, ViewToggle, VIZ, type ChartView } from "./charts";
import { ROUTE_ORDER, roundEstimate, type Assumptions, type CostStats, type Estimate, type WeekStats } from "./model";

// ---------- Shared bits ----------

function hoursTick(h: number): string {
  return `${formatNumber(h)} h`;
}

function weekLabel(iso: string): string {
  return formatCalendarDate(iso, { noYear: true });
}

/**
 * The quieter second tier: a flat panel with a hairline and no shadow, so it reads below the main cards. It sits
 * straight on the canvas, never inside a card.
 */
export function QuietPanel({
  titleId,
  title,
  description,
  children,
  className,
}: {
  titleId: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={titleId} className={cn("min-w-0 rounded-card bg-surface/70 p-5 ring-1 ring-line/70", className)}>
      <h3 id={titleId} className="text-base font-semibold text-heading">
        {title}
      </h3>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ---------- First response time, before and after ----------

const WIDE_QUERY = "(min-width: 1024px)";

/** True on the two-column layout, where the chart sits beside the tall calculator and can be taller. */
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(WIDE_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

export function BeforeAfterCard({
  baselineLabel,
  est,
  a,
  className,
}: {
  baselineLabel: string;
  est: Estimate;
  a: Assumptions;
  className?: string;
}) {
  const [view, setView] = useState<ChartView>("chart");
  const wide = useWide();
  const faster = est.afterMedianMin < est.beforeMedianMin;
  const afterRounded = Math.max(10, Math.round(est.afterMedianMin / 10) * 10);
  const data = est.weeks.map((w) => ({
    label: weekLabel(w.weekOf),
    longLabel: `Week of ${formatCalendarDate(w.weekOf, { noYear: true, long: true })}`,
    before: w.beforeMin,
    after: w.afterMin,
  }));
  const before = "Before (simulated)";
  const after = "With Care Desk (estimate)";
  return (
    <Card as="section" aria-labelledby="ba-title" data-tour="insights-before-after" className={className}>
      <CardHeader
        title={<span id="ba-title">First response time</span>}
        description="How long a patient waits for a first reply, week by week."
        actions={<ViewToggle label="Show first response time as" value={view} onChange={setView} />}
      />
      <p className="max-w-[60ch] text-base font-semibold text-heading text-balance sm:text-lg">
        {faster
          ? `From ${formatMinutes(est.beforeMedianMin)} to about ${formatMinutes(afterRounded)}, with the same team.`
          : `No faster at these numbers: ${formatMinutes(est.beforeMedianMin)} either way.`}
      </p>
      <div className="mt-4">
        {view === "chart" ? (
          <>
            <Legend
              className="mb-3"
              items={[
                { label: "Before", note: "simulated", color: VIZ.context },
                {
                  label: "With Care Desk",
                  note: "estimate",
                  color: VIZ.primary,
                },
              ]}
            />
            <PairedColumns
              data={data}
              height={wide ? 336 : 240}
              beforeLabel={before}
              afterLabel={after}
              tipBeforeLabel="Before, simulated"
              tipAfterLabel="With Care Desk"
              format={(m) => formatMinutes(m)}
              formatTick={hoursTick}
              unitMax={(m) => Math.round((m / 60) * 10) / 10}
              ariaLabel={`Median first response time by week. Before, simulated: about ${formatMinutes(est.beforeMedianMin)}. With Care Desk, estimated: about ${formatMinutes(est.afterMedianMin)}.`}
            />
          </>
        ) : (
          <DataTable
            caption="Median first response time by week"
            head={["Week of", "Messages", "Before", "With Care Desk", "Change"]}
            numeric={[1, 2, 3, 4]}
            rows={est.weeks.map((w) => [
              weekLabel(w.weekOf),
              formatNumber(w.messages),
              formatMinutes(w.beforeMin),
              formatMinutes(w.afterMin),
              w.afterMin <= w.beforeMin ? `${formatPercent(1 - w.afterMin / w.beforeMin)} faster` : "slower",
            ])}
          />
        )}
      </div>
      <Disclosure summary="How the estimate works" className="mt-4">
        <ul className="flex max-w-[70ch] flex-col gap-2 text-sm text-ink">
          <li>
            <span className="font-medium text-heading">Before:</span> {baselineLabel.replace(/^Simulated:\s*/i, "")}, every reply
            written by hand. A simulated baseline, median over {plural(est.weeks.length, "week")}.
          </li>
          <li>
            <span className="font-medium text-heading">After:</span> the same weeks with the demo queue&apos;s mix.{" "}
            {formatPercent(est.readyShare)} sent from a checked draft ({formatNumber(a.minutesPerReview)} min to review),{" "}
            {formatPercent(est.safetyShare)} straight to a clinician, the rest by hand ({formatNumber(a.minutesPerManualReply)}{" "}
            min).
          </li>
          <li>
            <span className="font-medium text-heading">Same team, same hours:</span> the wait shrinks in step with agent minutes
            per message, from {formatNumber(est.agentMinBefore)} to {formatNumber(roundEstimate(est.agentMinAfter))} min. Real
            queues usually shrink faster, so this errs low.
          </li>
        </ul>
      </Disclosure>
    </Card>
  );
}

// ---------- Safety ----------

function SafetyFact({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: typeof Stethoscope;
  tone: "clinician" | "hold" | "urgent";
  title: string;
  children: ReactNode;
}) {
  const toneClass = {
    clinician: "bg-clinician-bg text-clinician-fg",
    hold: "bg-hold-bg text-hold-icon",
    urgent: "bg-urgent-bg text-urgent-fg",
  }[tone];
  return (
    <li className="flex gap-3 sm:flex-col sm:gap-2.5">
      <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-pill", toneClass)}>
        <Icon aria-hidden size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-heading">{title}</p>
        <p className="mt-0.5 text-sm text-ink">{children}</p>
      </div>
    </li>
  );
}

export function SafetyCard({
  week,
  report,
  est,
  a,
  className,
}: {
  week: WeekStats;
  report: PublicEvalReport;
  est: Estimate;
  a: Assumptions;
  className?: string;
}) {
  const t = report.totals;
  const locked = week.lockedDrafts.checkFirst + week.lockedDrafts.withdrawn;
  const afterW = Math.max(1.5, Math.min(100, (est.safetyAfterMin / Math.max(1, est.safetyBeforeMin)) * 100));
  const safetyText =
    t.safetyCaught === t.safetyCases
      ? `all ${t.safetyCases} safety cases caught`
      : `${t.safetyCaught} of ${t.safetyCases} safety cases caught`;
  return (
    <Card as="section" aria-labelledby="safety-title" className={cn("flex flex-col", className)}>
      <CardHeader
        title={<span id="safety-title">Safety</span>}
        description="Messages that must never get an AI reply, from the demo queue."
      />
      <ul className="grid gap-4 sm:grid-cols-3 sm:gap-6">
        <SafetyFact icon={Stethoscope} tone="clinician" title={`${week.safety} went straight to a clinician`}>
          {week.routes.urgent} urgent, {week.routes.clinician} clinical. None got an AI reply.
        </SafetyFact>
        <SafetyFact icon={CirclePause} tone="hold" title={`Orders held for ${plural(week.holdPatients, "patient")}`}>
          Held on arrival, from {plural(week.holdMessages, "message")}. Only a clinician can resume them.
        </SafetyFact>
        {locked > 0 && (
          <SafetyFact icon={Lock} tone="urgent" title={`${plural(locked, "draft")} held back`}>
            The same patient raised an alert in another message
            {week.lockedDrafts.withdrawn > 0 && week.lockedDrafts.checkFirst > 0
              ? `: ${week.lockedDrafts.checkFirst} wait for a clinician, ${week.lockedDrafts.withdrawn} withdrawn.`
              : ", so these wait for a person."}
          </SafetyFact>
        )}
      </ul>

      <Divider className="my-5" />

      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-heading">
        <Clock aria-hidden size={16} className="text-muted-icon" />
        Median time to a person
      </h3>
      <dl className="mt-3 flex flex-col gap-3">
        {[
          {
            term: "Before, in the shared queue (simulated)",
            min: est.safetyBeforeMin,
            width: 100,
            color: VIZ.context,
          },
          {
            term: "With Care Desk, straight to a clinician",
            min: est.safetyAfterMin,
            width: afterW,
            color: VIZ.primary,
          },
        ].map((row) => (
          <div key={row.term} className="relative text-sm">
            <dt className="pr-24 text-ink">{row.term}</dt>
            <dd>
              <span className="absolute right-0 top-0 font-semibold text-heading tnum">{formatMinutes(row.min)}</span>
              <span
                aria-hidden
                className="mt-1 block h-2.5 rounded-r-[4px]"
                style={{ width: `${row.width}%`, backgroundColor: row.color }}
              />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">
        After uses the pick-up time in Your numbers ({formatNumber(a.clinicianPickupMin)} min): the rules flag the message on
        arrival.
      </p>

      <div className="mt-auto pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-cool pt-5">
          <p className="flex min-w-0 flex-1 basis-72 items-start gap-2 text-sm text-ink">
            <ShieldCheck aria-hidden size={16} className="mt-0.5 shrink-0 text-success-icon" />
            <span>
              <span className="font-semibold text-heading">On the test set:</span> {safetyText}, {t.holdsPlaced} of{" "}
              {t.holdsExpected} holds placed, {t.draftsPassedCheck} of {t.draftsWritten} drafts passed the fact check.
            </span>
          </p>
          <Button variant="ghost" size="sm" href="/tests/" trailingIcon={ArrowRight}>
            See the test results
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------- The demo queue: where messages went, and by type ----------

const ROUTE_FILL: Record<(typeof ROUTE_ORDER)[number], string> = {
  draft: "var(--color-success-icon)",
  person: "var(--color-info-fg)",
  clinician: "var(--color-clinician-accent)",
  urgent: "var(--color-urgent-solid)",
};

/**
 * Route names for this chart. The desk's "Ready to send" and "Write the reply" count what is left after patient-level
 * holds, so the raw routes get their own words here to avoid one name carrying two numbers.
 */
const ROUTING_LABEL: Record<(typeof ROUTE_ORDER)[number], string> = {
  draft: "Drafted",
  person: "Written by a person",
  clinician: ROUTE_LABEL.clinician,
  urgent: ROUTE_LABEL.urgent,
};

type QueueView = "route" | "type" | "table";

function TypeBars({ items, max, tone }: { items: WeekStats["categories"]; max: number; tone: "primary" | "safety" }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((c) => (
        <li key={c.category} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3">
          <span className="truncate text-sm text-ink">{categoryLabel(c.category)}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="block h-3 rounded-r-[4px]"
              style={{
                width: `${Math.max(2, (c.count / max) * 100)}%`,
                maxWidth: "calc(100% - 2.5rem)",
                backgroundColor: tone === "primary" ? VIZ.primary : VIZ.safety,
              }}
            />
            <span className="text-xs font-semibold text-heading tnum">{c.count}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function QueueCard({ week, report, className }: { week: WeekStats; report: PublicEvalReport; className?: string }) {
  const [view, setView] = useState<QueueView>("route");
  const t = report.totals;
  const locked = week.lockedDrafts.checkFirst + week.lockedDrafts.withdrawn;
  const routine = week.categories.filter((c) => !c.safety);
  const safety = week.categories.filter((c) => c.safety);
  const max = Math.max(...week.categories.map((c) => c.count), 1);
  return (
    <Card as="section" aria-labelledby="queue-title" className={className}>
      <CardHeader
        title={<span id="queue-title">Where messages went</span>}
        description={`The demo queue: ${plural(week.total, "fictional message")}.`}
      />
      <SegmentedControl<QueueView>
        size="sm"
        label="Show the demo queue"
        value={view}
        onChange={setView}
        items={[
          { id: "route", label: "By route" },
          { id: "type", label: "By type" },
          { id: "table", label: "Table" },
        ]}
      />
      <div className="mt-4">
        {view === "route" && (
          <>
            <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-[4px]" aria-hidden>
              {ROUTE_ORDER.map((r) =>
                week.routes[r] > 0 ? (
                  <span
                    key={r}
                    className="block h-full"
                    style={{
                      flexGrow: week.routes[r],
                      backgroundColor: ROUTE_FILL[r],
                    }}
                  />
                ) : null,
              )}
            </div>
            <ul className="mt-4 flex flex-col gap-2.5">
              {ROUTE_ORDER.map((r) => (
                <li key={r} className="flex items-center justify-between gap-3">
                  <RiskBadge kind={ROUTE_TO_RISK[r]} label={ROUTING_LABEL[r]} />
                  <span className="text-sm text-ink tnum">
                    <span className="font-semibold text-heading">{week.routes[r]}</span>
                    <span className="text-muted"> · {formatPercent(week.routes[r] / Math.max(1, week.total))}</span>
                  </span>
                </li>
              ))}
            </ul>
            {locked > 0 && (
              <p className="mt-4 text-sm text-ink">
                {locked} of the {week.routes.draft} drafts wait behind a safety alert, so {week.ready} are ready to send on the
                desk.
              </p>
            )}
            {t.draftsBlockedByCheck > 0 && (
              <p className="mt-2 text-sm text-ink">
                On the test set the fact check blocked {plural(t.draftsBlockedByCheck, "draft")}, so a person wrote those.
              </p>
            )}
          </>
        )}
        {view === "type" && (
          <div className="flex flex-col gap-5">
            <div>
              <h3 className="mb-2 text-xs font-medium text-ink">
                Routine:{" "}
                {plural(
                  routine.reduce((s, c) => s + c.count, 0),
                  "message",
                )}
              </h3>
              <TypeBars items={routine} max={max} tone="primary" />
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink">
                <Stethoscope aria-hidden size={14} className="text-clinician-fg" />
                Safety, never answered by AI:{" "}
                {plural(
                  safety.reduce((s, c) => s + c.count, 0),
                  "message",
                )}
              </h3>
              <TypeBars items={safety} max={max} tone="safety" />
            </div>
          </div>
        )}
        {view === "table" && (
          <DataTable
            caption="Messages by type in the demo queue"
            head={["Type", "Messages", "Share", "Checked draft"]}
            numeric={[1, 2, 3]}
            rows={week.categories.map((c) => [
              categoryLabel(c.category),
              c.count,
              formatPercent(c.count / Math.max(1, week.total)),
              c.safety ? "Never" : c.drafted,
            ])}
          />
        )}
      </div>
    </Card>
  );
}

// ---------- AI cost ----------

/** The public live box's daily AI budget, from the Worker's own defaults, so the card and the limit never disagree. */
const DAILY_CAP_USD = DEFAULT_LIMITS.dailyUsd;

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold text-heading tnum">{value}</dd>
    </div>
  );
}

export function CostCard({
  cost,
  week,
  meta,
  a,
  className,
}: {
  cost: CostStats;
  week: WeekStats;
  meta: PublicMeta;
  a: Assumptions;
  className?: string;
}) {
  const sample = meta.isMock || !cost.measured;
  const perWeek = cost.perMessageUsd * a.weeklyMessages;
  const models = [meta.models.sort, meta.models.draft];
  const noAi =
    week.noAiStops > 0
      ? `${week.noAiStops} of the demo queue's ${week.total} messages used no AI at all: urgent ones the safety rules stopped first.`
      : null;
  return (
    <QuietPanel titleId="cost-title" title="AI cost" className={className}>
      {sample ? (
        <>
          {/* No measured figure yet, so the one hard number is the spending limit the live box already enforces. */}
          <dl>
            <Figure label="Spending cap on the live try box" value={`${formatUsd(DAILY_CAP_USD)} a day`} />
          </dl>
          <p className="mt-2 text-sm text-ink">
            After that the box stops calling the AI until midnight UTC. The checks still run.
          </p>
          <Disclosure summary="Why there is no cost per message yet" className="mt-3">
            <div className="flex flex-col gap-2 text-sm text-ink">
              <p>
                It is measured from the tokens each test message uses when the test set runs with Claude. This sample run used{" "}
                {models.every((m) => m.startsWith("mock")) ? SAMPLE_STAND_IN : "a stand-in model"}, which costs nothing.
              </p>
              {noAi && <p>{noAi}</p>}
            </div>
          </Disclosure>
        </>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Figure label="Per message" value={formatUsd(cost.perMessageUsd)} />
            <Figure label="Per 1,000" value={formatUsd(cost.per1000Usd)} />
            <Figure label={`A week at ${formatNumber(a.weeklyMessages)}`} value={formatUsd(perWeek)} />
          </dl>
          <Disclosure summary="How this is measured" className="mt-3">
            <div className="flex flex-col gap-2 text-sm text-ink">
              <p>
                Averaged over {plural(cost.cases, "test message")}, from the tokens each one used. Sorting uses{" "}
                {modelLabel(meta.models.sort)}; drafting uses {modelLabel(meta.models.draft)}, at Anthropic&apos;s published
                rates.
              </p>
              {noAi && <p>{noAi}</p>}
            </div>
          </Disclosure>
        </>
      )}
    </QuietPanel>
  );
}

// ---------- What to automate next ----------

/** The next step that would let drafts cover more of a type. Product suggestions, not results. */
const NEXT_STEP: Partial<Record<RoutineCategory, string>> = {
  order_status: "Add worked examples of short or mixed order questions.",
  delivery_problem: "Give the drafter the courier's latest scan as a source.",
  script_renewal: "Add the repeats left on the script as a source.",
  billing: "Add the card processor's payment status as a source.",
  price_change: "Add the price notices sent in each country as a source.",
  plan_change: "Add each country's pause and cancel rules as sources.",
  appointment: "Connect the booking calendar, so drafts can offer real times.",
  account_access: "Connect account records, so drafts can confirm the login email.",
  product_question: "Add stock and packaging details as a source.",
  other: "Read these together to find the next type worth adding.",
};

/** Why the replies of a type were written by hand, in the run's own counts: the sorter's choice, its doubt, or a blocked draft. */
function whyByHand(c: WeekStats["automate"][number]): string {
  if (c.category === "other") return "Did not fit a known type.";
  const one = c.byHand === 1;
  const all = c.byHand === 2 ? "both" : `all ${c.byHand}`;
  if (c.unsure === c.byHand) return one ? "The sorter was unsure." : `The sorter was unsure on ${all}.`;
  if (c.chosePerson === c.byHand) return one ? "The sorter sent it to a person." : `The sorter sent ${all} to a person.`;
  if (c.blocked === c.byHand) return one ? "The fact check blocked the draft." : `The fact check blocked ${all} drafts.`;
  const parts = [
    c.chosePerson > 0 && `the sorter sent ${c.chosePerson} to a person`,
    c.unsure > 0 && `it was unsure on ${c.unsure}`,
    c.blocked > 0 && `the fact check blocked ${c.blocked === 1 ? "1 draft" : `${c.blocked} drafts`}`,
  ].filter(Boolean) as string[];
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function AutomateItem({ c, rank }: { c: WeekStats["automate"][number]; rank: number }) {
  const share = c.byHand / Math.max(1, c.total);
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-pill bg-field text-xs font-semibold text-heading tnum">
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm font-semibold text-heading">{categoryLabel(c.category as Category)}</p>
          <p className="text-xs text-muted tnum">
            {c.byHand} of {c.total} by hand
          </p>
        </div>
        <span aria-hidden className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-pill bg-field">
          <span className="block h-full rounded-pill" style={{ width: `${share * 100}%`, backgroundColor: VIZ.primary }} />
        </span>
        <p className="mt-1.5 text-sm text-ink">{NEXT_STEP[c.category] ?? "Look at why these went to a person."}</p>
        <p className="mt-0.5 text-xs text-muted">{whyByHand(c)}</p>
      </div>
    </li>
  );
}

export function AutomateCard({ week, className }: { week: WeekStats; className?: string }) {
  // "Other" is not a type a draft could cover yet, so it goes in the note at the foot rather than the ranking.
  const ranked = week.automate.filter((c) => c.category !== "other").slice(0, 5);
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  const other = week.automate.find((c) => c.category === "other");
  return (
    <QuietPanel
      titleId="next-title"
      title="What to automate next"
      description="Where people still wrote the most replies by hand."
      className={className}
    >
      {ranked.length === 0 ? (
        <div className="flex items-start gap-2 text-sm text-ink">
          <CircleCheck aria-hidden size={16} className="mt-0.5 shrink-0 text-success-icon" />
          <p>
            <span className="font-semibold text-heading">Every routine type got a draft.</span> When one starts needing replies by
            hand, it shows here with the step that would help most.
          </p>
        </div>
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-line-cool">
            {top.map((c, i) => (
              <AutomateItem key={c.category} c={c} rank={i + 1} />
            ))}
          </ol>
          {rest.length > 0 && (
            <Disclosure summary={`Show ${rest.length} more`} className="mt-3">
              <ol className="flex flex-col divide-y divide-line-cool">
                {rest.map((c, i) => (
                  <AutomateItem key={c.category} c={c} rank={top.length + i + 1} />
                ))}
              </ol>
            </Disclosure>
          )}
        </>
      )}
      {(week.byDesign.length > 0 || other) && (
        <Disclosure summary="Types that always go to a person" className="mt-1">
          <p className="text-sm text-ink">
            {week.byDesign.length > 0 && (
              <>
                {week.byDesign.map((b) => `${categoryLabel(b.category)} (${b.count})`).join(", ")}: always a person, however sure
                the sorter is.{other ? " " : ""}
              </>
            )}
            {other &&
              `${plural(other.total, "message")} fit no known type and also went to a person. Together they point to the next type worth adding.`}
          </p>
        </Disclosure>
      )}
    </QuietPanel>
  );
}

// ---------- How drafts were used in this browser ----------

const EDIT_FILL = {
  as_is: "#474e9c",
  light: "#6c73b8",
  rewritten: "#9fa5d6",
} as const;

export function EditsCard({ decisions, ready, className }: { decisions: Decision[]; ready: boolean; className?: string }) {
  const counts = useMemo(() => {
    const c = {
      as_is: 0,
      light: 0,
      rewritten: 0,
      written: 0,
      escalated: 0,
      reassigned: 0,
    };
    for (const d of decisions) {
      if (d.kind === "sent") c.as_is += 1;
      else if (d.kind === "sent_edited") {
        if (d.edit === "as_is") c.as_is += 1;
        else if (d.edit === "light") c.light += 1;
        else if (d.edit === "rewritten") c.rewritten += 1;
        else c.written += 1;
      } else if (d.kind === "escalated") c.escalated += 1;
      else c.reassigned += 1;
    }
    return c;
  }, [decisions]);
  const drafts = counts.as_is + counts.light + counts.rewritten;
  const segments = [
    { key: "as_is" as const, label: "Sent as is", n: counts.as_is },
    { key: "light" as const, label: "Lightly edited", n: counts.light },
    { key: "rewritten" as const, label: "Rewritten", n: counts.rewritten },
  ];
  const others = [
    counts.written > 0 && `${plural(counts.written, "reply", "replies")} written from scratch`,
    counts.escalated > 0 && `${counts.escalated} escalated`,
    counts.reassigned > 0 && `${counts.reassigned} reassigned`,
  ].filter(Boolean) as string[];

  return (
    <QuietPanel
      titleId="edits-title"
      title="How drafts were used"
      description="Your replies on the desk, in this browser."
      className={className}
    >
      {!ready ? null : drafts === 0 && others.length === 0 ? (
        <div className="flex items-start gap-4">
          <span className="block size-14 shrink-0 overflow-hidden rounded-pill bg-field">
            <Photo name="agent" alt="" sizes="56px" className="object-[50%_22%]" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-heading">No replies sent yet</p>
            <p className="mt-0.5 text-sm text-ink">
              Send a few drafts on the desk to see how many went as is, lightly edited or rewritten.
            </p>
            <Button variant="secondary" size="sm" href="/desk/" trailingIcon={ArrowRight} className="mt-3">
              Open the desk
            </Button>
          </div>
        </div>
      ) : (
        <>
          {drafts > 0 ? (
            <>
              <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-[4px]" aria-hidden>
                {segments.map((s) =>
                  s.n > 0 ? (
                    <span
                      key={s.key}
                      className="block h-full"
                      style={{
                        flexGrow: s.n,
                        backgroundColor: EDIT_FILL[s.key],
                      }}
                    />
                  ) : null,
                )}
              </div>
              <ul className="mt-4 flex flex-col gap-2">
                {segments.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="inline-flex items-center gap-2 text-ink">
                      <span
                        aria-hidden
                        className="inline-block size-2.5 rounded-[3px]"
                        style={{ backgroundColor: EDIT_FILL[s.key] }}
                      />
                      {s.label}
                    </span>
                    <span className="tnum">
                      <span className="font-semibold text-heading">{s.n}</span>
                      <span className="text-muted"> · {formatPercent(s.n / drafts)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-ink">No drafts sent yet: only replies written by a person.</p>
          )}
          {others.length > 0 && <p className="mt-3 text-sm text-muted">Also: {others.join(", ")}.</p>}
        </>
      )}
    </QuietPanel>
  );
}
