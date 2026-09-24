"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PipelineResult, StepId, TrailStep } from "@/lib/types";

/** How a step looks right now. Adds the transient "working" and the person-facing "awaiting" to StepStatus. */
export type DisplayState = "passed" | "stopped" | "flagged" | "skipped" | "failed" | "pending" | "working" | "awaiting";

export const STEP_ORDER: StepId[] = ["redact", "rules", "sort", "sources", "draft", "check", "decide"];

export const STAGGER_MS = 120;
export const STOP_HOLD_MS = 420;

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Always 7 steps in order, filling gaps with pending placeholders (so partial or malformed trails still render). */
export function normalizeTrail(trail: TrailStep[]): TrailStep[] {
  return STEP_ORDER.map(
    (id) =>
      trail.find((s) => s.id === id) ?? {
        id,
        status: "pending" as const,
        title: DEFAULT_TITLES[id],
        summary: "",
      },
  );
}

const DEFAULT_TITLES: Record<StepId, string> = {
  redact: "Personal details removed",
  rules: "Safety rules",
  sort: "Sorted by type",
  sources: "Sources found",
  draft: "Reply drafted",
  check: "Facts checked",
  decide: "A person decides",
};

export function stopIndex(steps: TrailStep[]): number {
  return steps.findIndex((s) => s.status === "stopped");
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  try {
    const mq = window.matchMedia(REDUCED_QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  } catch {
    return () => {};
  }
}

/** Live prefers-reduced-motion, safe during static rendering (false on the server). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

/**
 * Sequenced reveal. Returns how many steps are revealed (0 to 7). Steps tick every STAGGER_MS; at a stop the sequence
 * holds visibly, then the skipped steps settle together and the decide step lands last. Reduced motion: all at once.
 * Without animation the count is simply the total, worked out during render (no state is set in an effect).
 */
export function useReveal(result: PipelineResult, animate: boolean, onDone?: () => void, replayKey?: unknown): number {
  const steps = normalizeTrail(result.trail);
  const total = steps.length;
  const reduced = useReducedMotion();
  const sequenced = animate && !reduced;
  const [shown, setShown] = useState(0);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);
  const stopAt = stopIndex(steps);

  // A new message or a replay starts the sequence again: reset during render, before the timers are scheduled.
  const [run, setRun] = useState<{ id: string; key: unknown }>({ id: result.messageId, key: replayKey });
  if (run.id !== result.messageId || !Object.is(run.key, replayKey)) {
    setRun({ id: result.messageId, key: replayKey });
    setShown(0);
  }

  useEffect(() => {
    if (!animate) return;
    if (reduced) {
      // Everything is shown at once; the caller still hears that the reveal is done.
      doneRef.current?.();
      return;
    }
    const timers: number[] = [];
    let t = 160; // a beat before the first tick, so the start state is seen
    for (let i = 1; i <= total; i++) {
      const n = i;
      if (stopAt >= 0 && n === stopAt + 2) {
        // Hold on the stop, then settle every skipped step at once.
        t += STOP_HOLD_MS;
        timers.push(window.setTimeout(() => setShown(total - 1), t));
        t += STAGGER_MS * 2;
        timers.push(
          window.setTimeout(() => {
            setShown(total);
            doneRef.current?.();
          }, t),
        );
        break;
      }
      timers.push(
        window.setTimeout(() => {
          setShown(n);
          if (n === total) doneRef.current?.();
        }, t),
      );
      t += STAGGER_MS;
    }
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [animate, reduced, result.messageId, total, stopAt, replayKey]);

  return sequenced ? shown : total;
}

/** Display state of step i given the reveal position and whether a live run is still streaming. */
export function displayStateFor(
  steps: TrailStep[],
  i: number,
  shown: number,
  animating: boolean,
  running: boolean,
  stopAt: number = stopIndex(steps),
): DisplayState {
  const step = steps[i];
  const isDecide = step.id === "decide";
  if (animating && i >= shown) {
    // After a stop nothing is being worked on: the rest wait, quietly, until they settle as skipped.
    if (stopAt >= 0 && stopAt < shown) return "pending";
    return i === shown ? "working" : "pending";
  }
  const othersDone = steps.every((s) => s.id === "decide" || s.status !== "pending");
  if (isDecide) {
    if (step.status === "passed") return "passed";
    if (running && !othersDone) return "pending";
    return "awaiting";
  }
  if (step.status === "pending" && running) {
    const firstPending = steps.findIndex((s) => s.status === "pending");
    return firstPending === i ? "working" : "pending";
  }
  return step.status;
}
