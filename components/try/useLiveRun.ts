"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient, PipelineResult, TrailStep } from "@/lib/types";
import { prefersReducedMotion } from "@/components/trail/reveal";
import { BROWSER_STEP_MS, mergeStep, runInBrowser, runLive, sleep, type Fallback } from "./live";

export interface RunInput {
  patient: Patient;
  text: string;
}

export type RunState =
  | { phase: "idle" }
  | { phase: "running"; engine: "live" | "browser"; steps: TrailStep[]; input: RunInput; fallback?: Fallback; runId: number }
  | { phase: "done"; engine: "live" | "browser"; result: PipelineResult; input: RunInput; fallback?: Fallback; runId: number }
  | { phase: "failed"; input: RunInput; runId: number };

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Runs a message through the live API and streams the steps; falls back to the in-browser run (safety rules plus the
 * built-in stand-in for Claude), shown step by step, so the box never dead-ends. A newer run cancels the one before it.
 */
export function useLiveRun(opts: { vipKey?: string; takeTurnstileToken?: () => string | undefined }) {
  const [state, setState] = useState<RunState>({ phase: "idle" });
  const controller = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => () => controller.current?.abort(), []);

  const browserRun = useCallback(async (input: RunInput, runId: number, fallback: Fallback, signal: AbortSignal) => {
    setState({ phase: "running", engine: "browser", steps: [], input, fallback, runId });
    const { steps, result } = await runInBrowser(input.patient, input.text);
    const pace = prefersReducedMotion() ? 0 : BROWSER_STEP_MS;
    let shown: TrailStep[] = [];
    for (const step of steps) {
      if (pace) await sleep(pace, signal);
      shown = mergeStep(shown, step);
      const snapshot = shown;
      setState((s) => (s.phase === "running" && s.runId === runId ? { ...s, steps: snapshot } : s));
    }
    if (pace) await sleep(pace, signal);
    setState({ phase: "done", engine: "browser", result, input, fallback, runId });
  }, []);

  const run = useCallback(
    async (input: RunInput) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      const runId = ++counter.current;
      setState({ phase: "running", engine: "live", steps: [], input, runId });
      try {
        const token = optsRef.current.takeTurnstileToken?.();
        const outcome = await runLive(
          { personaId: input.patient.id, text: input.text, ...(token ? { turnstileToken: token } : {}) },
          {
            vipKey: optsRef.current.vipKey,
            signal: ac.signal,
            handlers: {
              onStep: (step) =>
                setState((s) => (s.phase === "running" && s.runId === runId ? { ...s, steps: mergeStep(s.steps, step) } : s)),
            },
          },
        );
        if (ac.signal.aborted) return;
        if (outcome.kind === "done") {
          const r = outcome.result;
          // deterministic_only means the live AI did not answer (no key, Claude failed, or the local MOCK stand-in).
          const fallback: Fallback | undefined = r.mode === "deterministic_only" ? { kind: "resting" } : undefined;
          setState({ phase: "done", engine: "live", result: r, input, fallback, runId });
          return;
        }
        await browserRun(input, runId, outcome.fallback, ac.signal);
      } catch (err) {
        if (isAbort(err) || ac.signal.aborted) return;
        // Even the browser run failed (for example the pipeline could not load): say so, and keep the text.
        setState({ phase: "failed", input, runId });
      }
    },
    [browserRun],
  );

  const reset = useCallback(() => {
    controller.current?.abort();
    setState({ phase: "idle" });
  }, []);

  return { state, run, reset };
}
