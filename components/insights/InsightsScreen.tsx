"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import { AppShell, PageHeader } from "@/components/shell";
import { Button, Card, LoadingStatus, Notice, SampleNotice, SAMPLE_RUN_TEXT, Skeleton, SkeletonText } from "@/components/ui";
import { useBaseline, useEvalReport, useMeta, useQueue } from "@/lib/client/data";
import { RESET_EVENT, useSession } from "@/lib/client/session";
import type { Baseline } from "@/lib/types";
import type { PublicEvalReport, PublicMeta, QueueFile } from "@/lib/client/types";
import { plural } from "@/lib/format";
import { AssumptionsPanel } from "./AssumptionsPanel";
import {
  ASSUMPTION_SPECS,
  costStats,
  defaultAssumptions,
  estimate,
  weekStats,
  type AssumptionKey,
  type Assumptions,
} from "./model";
import { AutomateCard, BeforeAfterCard, CostCard, EditsCard, QueueCard, SafetyCard } from "./sections";

const STORAGE_KEY = "caredesk.insights.assumptions.v1";

function readSaved(defaults: Assumptions): Assumptions | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Record<AssumptionKey, unknown>>;
    const out = { ...defaults };
    let any = false;
    for (const s of ASSUMPTION_SPECS) {
      const v = parsed[s.key];
      if (typeof v === "number" && Number.isFinite(v) && v >= s.min && v <= s.max) {
        out[s.key] = v;
        any = true;
      }
    }
    return any ? out : null;
  } catch {
    return null;
  }
}

function writeSaved(values: Assumptions | null) {
  try {
    if (values) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: the numbers still work for this visit */
  }
}

/**
 * The viewer's assumptions: simulated defaults from baseline.json, remembered in this browser, cleared by Reset.
 * Only mounted once the data has loaded, which never happens in the static render, so reading storage here is safe.
 */
function useAssumptions(baseline: Baseline) {
  const defaults = useMemo(() => defaultAssumptions(baseline), [baseline]);
  const [values, setValues] = useState<Assumptions>(() => readSaved(defaults) ?? defaults);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const onReset = () => {
      setValues(defaults);
      setVersion((v) => v + 1);
    };
    window.addEventListener(RESET_EVENT, onReset);
    return () => window.removeEventListener(RESET_EVENT, onReset);
  }, [defaults]);

  const change = useCallback((key: AssumptionKey, n: number) => {
    setValues((prev) => {
      const next = { ...prev, [key]: n };
      writeSaved(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    writeSaved(null);
    setValues(defaults);
    setVersion((v) => v + 1);
  }, [defaults]);

  return { defaults, values, version, change, reset };
}

export function InsightsScreen() {
  const queue = useQueue();
  const report = useEvalReport();
  const baseline = useBaseline();
  const meta = useMeta();
  const resources = [queue, report, baseline, meta];
  const failed = resources.find((r) => r.status === "error");
  const ready = resources.every((r) => r.status === "ready");

  const retryAll = () => resources.forEach((r) => r.status === "error" && r.retry());

  return (
    <AppShell>
      {ready && queue.data && report.data && baseline.data && meta.data ? (
        <Loaded queue={queue.data} report={report.data} baseline={baseline.data} meta={meta.data} />
      ) : failed ? (
        <>
          <PageHeader title="Insights" description="What Care Desk would save a support team, from simulated and test-set figures." />
          <Notice
            tone="error"
            role="alert"
            title="The figures did not load"
            actions={
              <Button variant="secondary" size="sm" leadingIcon={RotateCw} onClick={retryAll}>
                Try again
              </Button>
            }
          >
            {failed.error?.message ?? "Could not load the demo data. Check your connection and try again."}
          </Notice>
        </>
      ) : (
        <LoadingView />
      )}
    </AppShell>
  );
}

function LoadingView() {
  return (
    <>
      <PageHeader title="Insights" description={<SkeletonText lines={2} className="w-[min(40rem,80vw)] pt-1" />} />
      <LoadingStatus label="Loading the figures" />
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <Card className="lg:col-span-8 lg:row-start-1">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          <Skeleton className="mt-6 h-56 w-full" />
        </Card>
        <Card className="lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-4 h-20 w-full" rounded="card" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="mt-4 h-11 w-full" />
          ))}
        </Card>
        <Card className="lg:col-span-8 lg:row-span-2 lg:row-start-2">
          <Skeleton className="h-5 w-40" />
          <SkeletonText lines={4} className="mt-5" />
        </Card>
        <Card className="lg:col-span-4 lg:col-start-9 lg:row-start-3">
          <Skeleton className="h-5 w-40" />
          <SkeletonText lines={4} className="mt-5" />
        </Card>
      </div>
    </>
  );
}

/** The sentence behind the page's one "Sample results" chip. */
const SAMPLE_TEXT =
  `${SAMPLE_RUN_TEXT} The share of messages with a ready draft, which the time saved is built on, is a sample figure too.`;

function Loaded({
  queue,
  report,
  baseline,
  meta,
}: {
  queue: QueueFile;
  report: PublicEvalReport;
  baseline: Baseline;
  meta: PublicMeta;
}) {
  const session = useSession();
  const week = useMemo(() => weekStats(queue.items), [queue]);
  const { defaults, values: a, version, change, reset } = useAssumptions(baseline);
  const est = useMemo(() => estimate(week, baseline, a), [week, baseline, a]);
  const cost = useMemo(() => costStats(report, meta.isMock), [report, meta.isMock]);
  const decisions = useMemo(() => Object.values(session.data.decisions ?? {}), [session.data.decisions]);

  return (
    <>
      <PageHeader
        title="Insights"
        description={`What Care Desk would save a support team, from a fictional queue of ${plural(week.total, "message")} and numbers you can change.`}
        meta={meta.isMock ? <SampleNotice text={SAMPLE_TEXT} /> : undefined}
      />
      {/*
        Two columns on a wide screen, the calculator beside the chart. The grid rows are placed by hand so the tall
        calculator spans the first two rows and nothing leaves a gap; on a phone the source order reads: chart, your
        numbers, safety, the queue.
      */}
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <BeforeAfterCard baselineLabel={baseline.label} est={est} a={a} className="lg:col-span-8 lg:row-start-1" />
        <AssumptionsPanel
          className="lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1"
          values={a}
          defaults={defaults}
          onChange={change}
          onReset={reset}
          est={est}
          version={version}
        />
        <SafetyCard week={week} report={report} est={est} a={a} className="lg:col-span-8 lg:row-span-2 lg:row-start-2" />
        <QueueCard week={week} report={report} className="lg:col-span-4 lg:col-start-9 lg:row-start-3" />
      </div>

      <section aria-labelledby="more-title" className="mt-12 sm:mt-14">
        <h2 id="more-title" className="text-lg font-semibold text-heading">
          For the team lead
        </h2>
        <p className="mt-1 max-w-[65ch] text-sm text-muted">What to improve next, what the AI costs, and how you used the drafts.</p>
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-3 lg:gap-6">
          <AutomateCard week={week} />
          <CostCard cost={cost} week={week} meta={meta} a={a} />
          <EditsCard decisions={decisions} ready={session.ready} />
        </div>
      </section>
    </>
  );
}
