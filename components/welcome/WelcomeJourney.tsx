"use client";

import { useMemo, type ReactNode } from "react";
import { normalizeTrail, StatusIcon } from "@/components/trail";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/components/ui/cn";
import { useWelcomeCases } from "./WelcomeDemo";

/**
 * "How a message moves": the real sequence in three pictures. The people are photos; the middle step is the product
 * itself, the seven checks of the routine example (titles from its own trail), set on the eucalyptus texture.
 */
export function WelcomeJourney({ className }: { className?: string }) {
  return (
    <section aria-labelledby="welcome-flow-title" className={className}>
      <h2 id="welcome-flow-title" className="text-2xl font-semibold text-heading text-balance sm:text-3xl">
        How a message moves
      </h2>
      <p className="mt-2 max-w-[60ch] text-base text-muted">From a patient&apos;s phone to a person&apos;s reply.</p>
      <ol className="mt-10 grid gap-12 md:grid-cols-3 md:gap-8">
        <Step
          n={1}
          title="A patient writes in"
          visual={
            <Photo
              name="patient"
              sizes="(min-width: 1200px) 370px, (min-width: 768px) 31vw, 100vw"
              className="object-[70%_40%]"
            />
          }
        >
          By email or chat: an order, a refill, or a question about their health.
        </Step>
        <Step n={2} title="Care Desk checks it" visual={<ChecksVisual />}>
          Personal details removed, safety rules first, every fact checked against the records.
        </Step>
        <Step
          n={3}
          title="A person replies"
          visual={
            <Photo
              name="clinician"
              sizes="(min-width: 1200px) 370px, (min-width: 768px) 31vw, 100vw"
              className="object-[40%_50%]"
            />
          }
        >
          An agent sends routine replies. Anything clinical goes straight to a clinician, and the orders go on hold.
        </Step>
      </ol>
    </section>
  );
}

function Step({ n, title, visual, children }: { n: number; title: string; visual: ReactNode; children: ReactNode }) {
  return (
    <li className="min-w-0">
      <div className="relative aspect-[3/2] overflow-hidden rounded-card bg-panel md:aspect-[4/3]">{visual}</div>
      <h3 className="mt-6 flex items-center gap-3 text-lg font-semibold text-heading">
        <span
          aria-hidden
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-pill bg-navy-900 text-xs font-semibold text-white tnum"
        >
          {n}
        </span>
        <span>
          <span className="sr-only">Step {n}: </span>
          {title}
        </span>
      </h3>
      <p className="mt-2 max-w-[38ch] text-base text-ink">{children}</p>
    </li>
  );
}

/** The product in miniature: the seven checks, as the routine example ran them. */
function ChecksVisual() {
  const { routine } = useWelcomeCases();
  // Before the example loads, the default titles show with quiet markers, so the frame never jumps.
  const steps = useMemo(() => normalizeTrail(routine?.result.trail ?? []), [routine]);
  const loaded = !!routine;
  return (
    <>
      <div aria-hidden className="absolute inset-0">
        <Photo name="leaves-light" alt="" sizes="(min-width: 1200px) 370px, (min-width: 768px) 31vw, 100vw" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
        <div className="w-full max-w-[17.5rem] rounded-control bg-surface px-4 py-3 shadow-raised">
          <ul aria-label="The seven checks" className="flex flex-col gap-1">
            {steps.map((s, i) => {
              const last = i === steps.length - 1;
              const state = !loaded ? "pending" : last ? "awaiting" : s.status === "passed" ? "passed" : "skipped";
              return (
                <li key={s.id} className="flex items-center gap-2.5">
                  <StatusIcon state={state} size="sm" tone="light" stopTone="clinician" />
                  <span className={cn("min-w-0 truncate text-xs font-medium", last ? "text-heading" : "text-ink")}>
                    {s.title}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
