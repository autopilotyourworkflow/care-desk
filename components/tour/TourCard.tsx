"use client";

import { forwardRef, useId, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, CirclePlay, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Photo, PHOTOS } from "@/components/ui/Photo";
import { cn } from "@/components/ui/cn";
import type { Placement } from "./anchor";
import { NUMBERED_STOPS, STEP_NAMES, TOUR_STEP_COUNT } from "./steps";

/**
 * The lit area around the anchor. It never takes clicks, so the page stays usable. The rest of the page is dimmed
 * enough to step back, so the one thing the stop talks about is the thing that stands out.
 */
export function TourSpotlight({ spot, dim = false }: { spot: Placement["spot"]; dim?: boolean }) {
  if (typeof document === "undefined") return null;
  if (!spot && dim) {
    // Nothing to point at (the closing card): the same light dim, without a ring.
    return createPortal(
      <div aria-hidden data-tour-ui="" className="pointer-events-none fixed inset-0 z-[55] bg-navy-900/40" />,
      document.body,
    );
  }
  return createPortal(
    <div
      aria-hidden
      data-tour-ui=""
      className={cn(
        "pointer-events-none fixed z-[55] transition-[top,left,width,height,opacity] duration-200 ease-out-expo",
        spot ? "opacity-100" : "opacity-0",
      )}
      style={
        spot
          ? {
              top: spot.top,
              left: spot.left,
              width: spot.width,
              height: spot.height,
              borderRadius: spot.radius,
              boxShadow: "0 0 0 3px #ffffff, 0 0 0 200vmax rgb(1 3 55 / 0.4)",
            }
          : { top: "50%", left: "50%", width: 0, height: 0 }
      }
    />,
    document.body,
  );
}

export interface TourCardProps {
  stopIndex: number;
  step: number;
  title: string;
  body: string;
  placement: Placement | null;
  isFirst: boolean;
  isLast: boolean;
  /** The closing card: no step number, a full progress bar, and `children` below the body. */
  end?: boolean;
  children?: ReactNode;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  nextRef: RefObject<HTMLButtonElement | null>;
}

/** Stops grouped by step, for the progress bar: [[0, 1], [2, 3], [4], [5, 6], [7, 8], [9]]. */
const GROUPS: number[][] = Array.from({ length: TOUR_STEP_COUNT }, (_, i) =>
  NUMBERED_STOPS.map((s, j) => (s.step === i + 1 ? j : -1)).filter((j) => j >= 0),
);

/** How full each step's segment is: done steps full, the current one by how many of its stops are seen. */
export function segmentFill(stopIndex: number, end = false): number[] {
  return GROUPS.map((group) => {
    if (end || !group.length) return end ? 1 : 0;
    const seen = group.filter((j) => j <= stopIndex).length;
    return seen / group.length;
  });
}

/**
 * The tour's card: a non-modal dialog beside the anchor on desktop, docked to the bottom on a phone, centred when
 * the anchor is missing. Five dots and "1 of 5", a short title and one or two sentences, then Skip, Back and Next
 * (Finish on the last card). The arrow keys and Esc work too, without a hint taking up room.
 */
export const TourCard = forwardRef<HTMLDivElement, TourCardProps>(function TourCard(
  { stopIndex, step, title, body, placement, isFirst, isLast, end = false, children, onNext, onBack, onSkip, nextRef },
  ref,
) {
  const titleId = useId();
  const bodyId = useId();
  if (typeof document === "undefined") return null;
  const mode = placement?.mode ?? "centred";
  const measured = !!placement;
  const fill = segmentFill(stopIndex, end);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-tour-ui=""
      className={cn(
        "fixed z-[60] animate-rise-in rounded-card bg-surface p-5 text-ink shadow-pop ring-1 ring-navy-900/10",
        mode === "sheet" && "inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] overflow-y-auto p-4",
        // Nothing to keep in view behind the closing card, so it may use most of the screen.
        mode === "sheet" && (end ? "max-h-[88dvh]" : "max-h-[52dvh]"),
        mode === "centred" && "left-1/2 top-1/2 w-[min(400px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2",
        mode === "anchored" && "w-[min(360px,calc(100vw-2rem))] transition-[top,left] duration-200 ease-out-expo",
        mode === "centred" && end && "w-[min(440px,calc(100vw-2rem))]",
        !measured && "invisible",
      )}
      style={
        mode === "anchored" && placement?.pos
          ? { top: placement.pos.top, left: placement.pos.left, width: placement.pos.width }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-3">
        {end ? (
          <p className="text-xs font-medium text-muted">Tour complete</p>
        ) : (
          <p className="flex items-center gap-3 text-xs font-medium text-muted">
            {/* One dot per step: the current one drawn long, the ones done filled. */}
            <span aria-hidden className="flex items-center gap-1.5">
              {fill.map((f, g) => (
                <span
                  key={g}
                  className={cn(
                    "h-1.5 rounded-pill transition-[width,background-color] duration-200 ease-out-expo",
                    g === step - 1 ? "w-5 bg-navy-900" : f >= 1 ? "w-1.5 bg-navy-900" : "w-1.5 bg-navy-100",
                  )}
                />
              ))}
            </span>
            <span className="tnum">
              <span className="sr-only">Step </span>
              {step} of {TOUR_STEP_COUNT}
            </span>
          </p>
        )}
        <button
          type="button"
          onClick={onSkip}
          aria-label="Close the tour"
          className="-mr-1.5 -mt-1 inline-flex size-8 items-center justify-center rounded-inner text-muted-icon transition-colors duration-150 hover:bg-navy-900/[0.06] hover:text-heading active:bg-navy-900/10"
        >
          <X aria-hidden size={18} />
        </button>
      </div>

      {end ? (
        // The closing card: the builder's own photo beside his thanks, in the first person.
        <div className="mt-4 flex items-start gap-4">
          <span className="block size-16 shrink-0 overflow-hidden rounded-pill bg-field ring-1 ring-navy-900/10">
            <Photo name="beam" sizes="64px" alt={PHOTOS.beam.alt} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold leading-snug text-heading">
              {title}
            </h2>
            <p id={bodyId} className="mt-1 text-sm leading-relaxed text-ink">
              {body}
            </p>
          </div>
        </div>
      ) : (
        <>
          <h2 id={titleId} className="mt-3 text-lg font-semibold leading-snug text-heading text-balance">
            {title}
          </h2>
          <p id={bodyId} className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink">
            {body}
          </p>
        </>
      )}
      {children}

      <div className="mt-5 flex items-center gap-2">
        {!end && (
          <Button variant="ghost" size="sm" onClick={onSkip} className="-ml-2 text-muted hover:text-heading">
            Skip tour
          </Button>
        )}
        <span className="ml-auto flex items-center gap-2">
          {!isFirst && (
            <Button variant="secondary" size="sm" onClick={onBack} leadingIcon={ArrowLeft} aria-label="Back">
              <span className="hidden sm:inline">Back</span>
            </Button>
          )}
          {/* On the closing card the email link is the one main action, so Finish steps down to secondary. */}
          <Button
            ref={nextRef}
            size="sm"
            variant={end ? "secondary" : "primary"}
            onClick={onNext}
            trailingIcon={isLast ? Check : ArrowRight}
          >
            {isLast ? "Finish" : "Next"}
          </Button>
        </span>
      </div>
    </div>,
    document.body,
  );
});

/** Shown when the visitor has wandered to another page mid-tour: resume the step, or end the tour. */
export function TourAway({
  step,
  end = false,
  onResume,
  onEnd,
}: {
  step: number;
  end?: boolean;
  onResume: () => void;
  onEnd: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="region"
      aria-label="Tour paused"
      data-tour-ui=""
      className="fixed bottom-4 right-4 z-[60] flex w-[min(340px,calc(100vw-2rem))] animate-rise-in items-center gap-3 rounded-control bg-surface p-3 pl-4 shadow-pop ring-1 ring-navy-900/10 max-sm:inset-x-3 max-sm:w-auto"
    >
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold text-heading">Tour paused</span>
        <span className="block text-xs text-muted">
          {end ? "Last card: thanks, and how to reach me" : `Step ${step} of ${TOUR_STEP_COUNT}: ${STEP_NAMES[step - 1]}`}
        </span>
      </p>
      <Button size="sm" onClick={onResume} leadingIcon={CirclePlay}>
        Resume
      </Button>
      <button
        type="button"
        onClick={onEnd}
        aria-label="End the tour"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-inner text-muted-icon transition-colors duration-150 hover:bg-navy-900/[0.06] hover:text-heading active:bg-navy-900/10"
      >
        <X aria-hidden size={18} />
      </button>
    </div>,
    document.body,
  );
}
