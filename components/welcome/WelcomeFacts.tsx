"use client";

import type { ReactNode } from "react";
import { Photo } from "@/components/ui/Photo";
import { SAMPLE_RUN_TEXT, SampleNotice } from "@/components/ui/SampleNotice";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useIsSample, useMeta } from "@/lib/client/data";
import { formatNumber } from "@/lib/format";

/** "all 75" when every one was caught, else "73 of 75". */
function share(part: number, whole: number): string {
  return part === whole ? `all ${formatNumber(whole)}` : `${formatNumber(part)} of ${formatNumber(whole)}`;
}

/** The first promise, with the test set's own numbers. Falls back to the mechanism alone if meta.json cannot load. */
function SafetyFact() {
  const meta = useMeta();
  const t = meta.data?.welcome.totals;
  let rest: ReactNode;
  if (t) {
    // Every group is named, so the numbers add up for a reader: the safety messages and the everyday ones make the
    // whole test set, and the holds are counted within it (most of them on those same safety messages), not beside it.
    const everyday = t.cases - t.safetyCases;
    const allHeld = t.holdsPlaced === t.holdsExpected;
    rest = (
      <>
        Clinical questions never get an AI reply. Of {formatNumber(t.cases)} test messages,{" "}
        {formatNumber(t.safetyCases)} raised a safety concern and{" "}
        <strong className="font-semibold text-heading">{share(t.safetyCaught, t.safetyCases)}</strong> went to a
        clinician; the other {formatNumber(everyday)} were everyday questions.{" "}
        {allHeld ? (
          <>
            <strong className="font-semibold text-heading">All {formatNumber(t.holdsExpected)}</strong> order holds the
            tests called for were placed, most of them on those same safety messages.
          </>
        ) : (
          <>
            Only <strong className="font-semibold text-heading">{formatNumber(t.holdsPlaced)}</strong> of the{" "}
            {formatNumber(t.holdsExpected)} order holds the tests called for were placed.
          </>
        )}
      </>
    );
  } else if (meta.status === "error") {
    rest = <>Clinical questions, side effects, crisis language and reports of a death stop the checks. A clinician answers.</>;
  } else {
    rest = <SkeletonText lines={3} className="mt-1.5" />;
  }
  return <Fact lead="Safety rules run first" rest={rest} />;
}

function Fact({ lead, rest }: { lead: string; rest: ReactNode }) {
  return (
    <li className="min-w-0">
      <h3 className="text-lg font-semibold text-heading">{lead}</h3>
      <div className="mt-2 max-w-[40ch] text-base text-ink">{rest}</div>
    </li>
  );
}

/**
 * "What keeps it safe": the three promises, one or two sentences each, on a calm eucalyptus band. The text sits on a
 * solid white panel, never on the photo itself. The one sample-results note of the page sits under them.
 */
export function WelcomeFacts() {
  const sample = useIsSample();
  return (
    <section aria-labelledby="welcome-facts-title" className="relative isolate overflow-hidden">
      <div aria-hidden className="absolute inset-0 -z-10">
        <Photo name="leaves-light" alt="" sizes="100vw" className="object-[50%_35%]" />
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="rounded-card bg-surface p-6 shadow-raised sm:p-10">
          <h2 id="welcome-facts-title" className="text-2xl font-semibold text-heading sm:text-3xl">
            What keeps it safe
          </h2>
          <ul className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
            <SafetyFact />
            <Fact
              lead="Every fact is checked"
              rest="Dates, amounts, order and tracking numbers must match the patient's records, or the draft is blocked."
            />
            <Fact
              lead="A person always sends"
              rest="AI only drafts routine replies. An agent reads each one, then sends, edits or passes it on."
            />
          </ul>
          {sample && (
            <div className="mt-8 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-line-cool pt-5 text-xs text-muted">
              <SampleNotice text={SAMPLE_RUN_TEXT} side="top" />
              <span>The safety rules are real. The sorting and drafting shown here are samples.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
