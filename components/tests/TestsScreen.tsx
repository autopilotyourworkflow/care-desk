"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { AppShell, DEFAULT_SHORTCUTS, PageHeader, type ShortcutGroup } from "@/components/shell";
import { Button, Card, LoadingStatus, Notice, SampleNotice, Skeleton, SkeletonText } from "@/components/ui";
import { useEvalReport, useMeta } from "@/lib/client/data";
import { modelLabel } from "@/lib/format";
import { Headline } from "./Headline";
import { ByType, FactCheck } from "./Accuracy";
import { TrickyCases } from "./TrickyCases";
import { CaseTable } from "./CaseTable";
import { AboutTests } from "./HowTested";

const CASE_ID = /^MSG-\d{4}$/;

const SHORTCUTS: ShortcutGroup[] = [
  { title: "On this page", items: [{ keys: ["/"], label: "Search the test cases" }] },
  ...DEFAULT_SHORTCUTS.filter((g) => g.title === "Anywhere"),
];

/**
 * Reads ?case= (inside its own Suspense boundary, so the rest of the page prerenders). ?m= is accepted too, the
 * deep-link name used across the app, so links from the desk and the clinician view open the case.
 */
function CaseParam({ onChange }: { onChange: (id: string | null) => void }) {
  const params = useSearchParams();
  const value = params.get("case") ?? params.get("m");
  useEffect(() => {
    onChange(value ? value.trim().toUpperCase() : null);
  }, [value, onChange]);
  return null;
}

function setCaseInUrl(id: string | null) {
  try {
    const url = id ? `${window.location.pathname}?case=${encodeURIComponent(id)}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  } catch {
    /* history blocked: the page still works, the link just does not update */
  }
}

/** The one honest sentence behind the "Sample results" chip (the shared toggletip, the same on every screen). */
const sampleText = (model: string) =>
  `The sorting and drafting figures come from a sample run that used ${model} in place of Claude. The safety rules and the fact check are the real ones.`;

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <LoadingStatus label="Loading the test results" />
      <Card padding="lg">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
          <div className="flex flex-col gap-4">
            <Skeleton rounded="pill" className="h-7 w-44" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
            <SkeletonText lines={2} />
          </div>
          <div className="flex flex-col gap-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton rounded="pill" className="size-5 shrink-0" />
                <SkeletonText lines={2} className="flex-1" />
              </div>
            ))}
          </div>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
        <Card>
          <Skeleton className="mb-5 h-5 w-40" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </Card>
        <Card>
          <Skeleton className="mb-5 h-5 w-28" />
          <SkeletonText lines={2} />
          <Skeleton rounded="pill" className="mt-5 h-2.5 w-full" />
          <Skeleton className="mt-5 h-24 w-full" />
        </Card>
      </div>
    </div>
  );
}

/** The Test results page: the proof. Every figure is read from public/data/eval-report.json. */
export function TestsScreen() {
  const report = useEvalReport();
  const meta = useMeta();
  const [openId, setOpenId] = useState<string | null>(null);
  const [revealToken, setRevealToken] = useState(0);
  const [param, setParam] = useState<string | null>(null);
  const [missingId, setMissingId] = useState<string | null>(null);
  const [handledParam, setHandledParam] = useState<string | null>(null);

  const onParam = useCallback((id: string | null) => setParam(id), []);

  // Open the case named in ?case= once the report is here, and again whenever the address names another case.
  // handledParam is the last address value seen, so the page's own URL updates never reopen a closed case.
  // Adjusted during render rather than in an effect, so the case opens in the same pass.
  if (report.data && param !== handledParam) {
    setHandledParam(param);
    if (param && param !== openId) {
      const exists = CASE_ID.test(param) && report.data.cases.some((c) => c.messageId === param);
      if (exists) {
        setMissingId(null);
        setOpenId(param);
        setRevealToken((n) => n + 1);
      } else {
        setMissingId(param);
      }
    }
  }

  const changeOpen = useCallback((id: string | null) => {
    setOpenId(id);
    setMissingId(null);
    setCaseInUrl(id);
  }, []);

  const openAndReveal = useCallback(
    (id: string) => {
      changeOpen(id);
      setRevealToken((n) => n + 1);
    },
    [changeOpen],
  );

  const dismissMissing = useCallback(() => {
    setMissingId(null);
    setCaseInUrl(null);
  }, []);

  const isMock = meta.data?.isMock ?? false;
  const r = report.data;

  return (
    <AppShell shortcuts={SHORTCUTS}>
      <Suspense fallback={null}>
        <CaseParam onChange={onParam} />
      </Suspense>

      <PageHeader
        title="Test results"
        description={
          r
            ? `How Care Desk handled ${r.cases.length} fictional patient messages, including ones written to trip it up.`
            : "How Care Desk handled a set of fictional patient messages, including ones written to trip it up."
        }
        meta={isMock && meta.data ? <SampleNotice text={sampleText(modelLabel(meta.data.models.sort))} /> : undefined}
      />

      {report.status === "error" ? (
        <Card>
          <Notice
            tone="error"
            role="alert"
            title="The test results did not load"
            actions={
              <Button size="sm" variant="secondary" leadingIcon={RotateCcw} onClick={report.retry}>
                Try again
              </Button>
            }
          >
            {report.error?.message ?? "Could not load the demo data. Check your connection and try again."}
          </Notice>
        </Card>
      ) : !r ? (
        <PageSkeleton />
      ) : (
        <div className="flex flex-col gap-4 sm:gap-6">
          <Headline report={r} onOpen={openAndReveal} />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
            <ByType report={r} />
            <FactCheck report={r} />
          </div>
          <TrickyCases report={r} onOpen={openAndReveal} />
          <CaseTable
            report={r}
            openId={openId}
            onOpenChange={changeOpen}
            revealToken={revealToken}
            missingId={missingId}
            onDismissMissing={dismissMissing}
            onReveal={openAndReveal}
          />
          <AboutTests report={r} />
        </div>
      )}
    </AppShell>
  );
}
