"use client";

import { useEffect, useMemo, useState } from "react";
import { Mail, MessageCircle, Pause, Play } from "lucide-react";
import type { Patient, PatientMessage, PipelineResult } from "@/lib/types";
import { COUNTRY_LABEL } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { HoldBadge } from "@/components/ui/RiskBadge";
import { StatusIcon } from "./Trail";
import { displayStateFor, normalizeTrail, prefersReducedMotion, stopIndex, useReveal, type DisplayState } from "./reveal";
import { AFTER_STOP_TITLE, outcomeText } from "./outcome";

export { outcomeText };

export interface TrailMiniProps {
  result: PipelineResult;
  animate?: boolean;
  /** "navy" sits directly on the navy welcome field; "light" sits on a white card. */
  tone?: "light" | "navy";
  onDone?: () => void;
  replayKey?: unknown;
  className?: string;
}

const MINI_WORD: Partial<Record<DisplayState, string>> = {
  passed: "Passed",
  stopped: "Stopped here",
  failed: "Blocked",
  flagged: "Flagged",
  skipped: "Skipped",
  working: "Checking",
  awaiting: "Your call",
};

/**
 * A compact, non-interactive trail for the welcome screen. It demonstrates the mechanism: steps tick in sequence and
 * a safety stop halts the run. Screen readers get one plain sentence instead of the animation.
 */
export function TrailMini({ result, animate = true, tone = "navy", onDone, replayKey, className }: TrailMiniProps) {
  const steps = useMemo(() => normalizeTrail(result.trail), [result.trail]);
  const stopAt = stopIndex(steps);
  const shown = useReveal(result, animate, onDone, replayKey);
  const animating = animate && shown < steps.length;
  const navy = tone === "navy";
  const stopTone = result.route === "urgent" ? "urgent" : "clinician";
  const safety = result.route === "clinician" || result.route === "urgent";

  return (
    <div className={className}>
      <p className="sr-only">
        Check trail for this message:{" "}
        {steps.filter((s, i) => s.status === "passed" && !(stopAt >= 0 && i > stopAt)).length} checks passed.{" "}
        {stopAt >= 0 ? `Stopped at ${steps[stopAt].title}. ` : ""}
        {outcomeText(result)}
      </p>
      <ol aria-hidden className="flex flex-col">
        {steps.map((step, i) => {
          const state = displayStateFor(steps, i, shown, animating, false, stopAt);
          const quiet = state === "pending" || state === "skipped";
          // A check that still ran after the stop (a look for anything more urgent) is not a green "Passed": the
          // message did not carry on, so it reads as a neutral "Checked".
          const checkedAfterStop = stopAt >= 0 && i > stopAt && state === "passed" && step.id !== "decide";
          const word =
            step.id === "decide" && state === "awaiting" && safety
              ? "Clinician"
              : checkedAfterStop
                ? "Checked"
                : MINI_WORD[state];
          const isLast = i === steps.length - 1;
          return (
            <li key={step.id} className={cn("relative flex items-start gap-3", !isLast && "pb-2.5")}>
              {!isLast && (
                <span
                  className={cn(
                    "absolute bottom-0 left-[9px] top-5 border-l-2",
                    state === "stopped" || state === "skipped" || checkedAfterStop
                      ? navy
                        ? "border-dashed border-white/20"
                        : "border-dashed border-line-strong"
                      : state === "passed" && !checkedAfterStop
                        ? navy
                          ? "border-[#7fe0a8]/40"
                          : "border-success-icon/45"
                        : navy
                          ? "border-white/12"
                          : "border-line-cool",
                  )}
                />
              )}
              <StatusIcon
                state={state}
                size="sm"
                tone={tone}
                stopTone={stopTone}
                clinician={step.id === "decide" && safety}
                neutral={checkedAfterStop}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 text-pretty text-sm font-medium transition-colors duration-200",
                  // The check after the stop reads in the quiet colour, as part of the stop, not the next step.
                  navy
                    ? quiet
                      ? "text-on-navy-muted/70"
                      : checkedAfterStop
                        ? "text-on-navy-muted"
                        : "text-white"
                    : quiet || checkedAfterStop
                      ? "text-muted"
                      : "text-heading",
                )}
              >
                {step.id === "decide" && safety ? "A clinician decides" : checkedAfterStop ? AFTER_STOP_TITLE : step.title}
              </span>
              {word && (
                <span
                  key={state}
                  className={cn(
                    "shrink-0 animate-rise-in py-0.5 text-xs font-semibold",
                    state === "stopped"
                      ? navy
                        ? cn("rounded-pill bg-white px-2 py-0.5", stopTone === "urgent" ? "text-urgent-fg" : "text-clinician-fg")
                        : cn("rounded-pill px-2 py-0.5 text-white", stopTone === "urgent" ? "bg-urgent-solid" : "bg-clinician-fg")
                      : navy
                        ? state === "passed" && !checkedAfterStop
                          ? "text-[#9ee8bd]"
                          : "text-on-navy-muted"
                        : state === "passed" && !checkedAfterStop
                          ? "text-success-fg"
                          : "text-muted",
                  )}
                >
                  {state === "stopped" ? (
                    <>
                      <span className="sm:hidden">Stopped</span>
                      <span className="hidden sm:inline">{word}</span>
                    </>
                  ) : (
                    word
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div
        aria-hidden
        className={cn(
          "mt-4 flex min-h-12 flex-wrap items-center gap-2 border-t pt-3 text-sm transition-opacity duration-200",
          navy ? "border-white/12 text-white" : "border-line-cool text-ink",
          animating ? "opacity-0" : "opacity-100",
        )}
      >
        <span className="font-medium">{outcomeText(result)}</span>
        {result.holdOrders && <HoldBadge />}
      </div>
    </div>
  );
}

export interface MiniCase {
  message: PatientMessage;
  patient?: Pick<Patient, "firstName" | "country">;
  result: PipelineResult;
}

/**
 * The welcome screen's live demo: runs each case in turn (an order question to a checked draft, then a medication
 * question that stops at the safety rules), holds on the outcome, then moves on. Pausable (WCAG 2.2.2), and paused
 * while hovered or focused.
 */
export function TrailMiniLoop({
  cases,
  tone = "navy",
  holdMs = 3200,
  className,
}: {
  cases: MiniCase[];
  tone?: "light" | "navy";
  holdMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const navy = tone === "navy";
  const c = cases[index % cases.length];

  useEffect(() => {
    if (!done || paused || hovered || cases.length < 2) return;
    const t = window.setTimeout(
      () => {
        setDone(false);
        setIndex((i) => (i + 1) % cases.length);
        setRun((r) => r + 1);
      },
      prefersReducedMotion() ? holdMs * 2 : holdMs,
    );
    return () => window.clearTimeout(t);
  }, [done, paused, hovered, holdMs, cases.length]);

  if (!c) return null;
  const Channel = c.message.channel === "email" ? Mail : MessageCircle;

  return (
    <div
      className={cn(
        "rounded-card p-4 sm:p-6",
        navy ? "bg-white/[0.06] ring-1 ring-white/12" : "bg-surface shadow-card ring-1 ring-line/70",
        className,
      )}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className={cn("text-xs font-medium", navy ? "text-on-navy-muted" : "text-muted")}>
          Live example {(index % cases.length) + 1} of {cases.length}
        </p>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-inner px-2.5 text-xs font-medium transition-colors duration-150",
            navy ? "text-white hover:bg-white/10" : "text-heading hover:bg-field",
          )}
        >
          {paused ? <Play aria-hidden size={14} /> : <Pause aria-hidden size={14} />}
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <figure
        key={`msg-${index}-${run}`}
        className={cn(
          "mb-5 animate-rise-in rounded-control p-3.5",
          navy ? "bg-white text-ink" : "bg-inset text-ink",
        )}
      >
        <figcaption className="mb-1 flex items-center gap-1.5 text-xs text-muted">
          <Channel aria-hidden size={13} />
          {c.patient ? `${c.patient.firstName}, ${COUNTRY_LABEL[c.patient.country]}` : "A patient"}
        </figcaption>
        <blockquote className="line-clamp-3 text-sm leading-relaxed">{c.message.body}</blockquote>
      </figure>

      <TrailMini
        key={`trail-${index}-${run}`}
        result={c.result}
        tone={tone}
        animate
        replayKey={run}
        onDone={() => setDone(true)}
      />
    </div>
  );
}
