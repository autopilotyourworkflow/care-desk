/**
 * The live box's client logic, with no UI: call POST /api/try, read the newline-delimited JSON StepEvent stream, and
 * fall back to running the pipeline in the browser (safety rules plus the built-in stand-in) when the API is unreachable,
 * errors or answers "limited".
 * Every patient is fictional demo material. Nothing the visitor types is stored.
 */
import type { PatientMessage, Patient, PipelineResult, StepEvent, TrailStep } from "@/lib/types";
import { BASE_PATH } from "@/lib/client/data";

export const MAX_CHARS = 1200;
/**
 * How long the live API may go quiet before the page runs the rules in the browser instead. An idle timeout, reset by
 * every streamed step, not a limit on the whole run: the Worker keeps its own run deadline below this (worker/budget.ts),
 * so a slow but working run always gets to finish.
 */
export const LIVE_TIMEOUT_MS = 45_000;
/** Pace of the in-browser replay, so the steps visibly tick in. Reduced motion: no delay. */
export const BROWSER_STEP_MS = 240;

export const TRY_URL = `${BASE_PATH}/api/try`;

/** Why the page is showing the rules-only run. */
export type Fallback =
  | { kind: "limited"; reason: "visitor" | "daily"; resetAt: string }
  | { kind: "unreachable" }
  | { kind: "error"; message?: string }
  /** The API answered, but without the live AI (no key, or Claude failed): the result says deterministic_only. */
  | { kind: "resting" };

/** Same clean-up as the Worker: CRLF to LF, trimmed. Rule-hit indices point into this exact string. */
export function normaliseText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

/** Characters as the Worker counts them (code points). */
export function charCount(text: string): number {
  return [...text].length;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Loose shape check for one line of the stream. Anything else is ignored. */
export function asStepEvent(v: unknown): StepEvent | undefined {
  if (!isRecord(v) || typeof v.type !== "string") return undefined;
  switch (v.type) {
    case "step":
      return isRecord(v.step) && typeof v.step.id === "string" && typeof v.step.status === "string" ? (v as StepEvent) : undefined;
    case "done":
      return isRecord(v.result) && Array.isArray(v.result.trail) && typeof v.result.route === "string" ? (v as StepEvent) : undefined;
    case "limited":
      return (v.reason === "visitor" || v.reason === "daily") && typeof v.resetAt === "string" ? (v as StepEvent) : undefined;
    case "error":
      return { type: "error", message: typeof v.message === "string" ? v.message : "" };
    default:
      return undefined;
  }
}

/** Reads a newline-delimited JSON stream, yielding each parsed line. A broken line yields undefined. */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const parse = (line: string): unknown => {
    try {
      return JSON.parse(line);
    } catch {
      return undefined;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield parse(line);
        nl = buf.indexOf("\n");
      }
    }
    buf += dec.decode();
    if (buf.trim()) yield parse(buf.trim());
  } finally {
    reader.releaseLock();
  }
}

/** Merge one streamed step into the list (by id, so a repeat replaces the earlier one). */
export function mergeStep(steps: TrailStep[], step: TrailStep): TrailStep[] {
  const i = steps.findIndex((s) => s.id === step.id);
  if (i < 0) return [...steps, step];
  const next = steps.slice();
  next[i] = step;
  return next;
}

export interface LiveHandlers {
  onStep: (step: TrailStep) => void;
}

export type LiveOutcome = { kind: "done"; result: PipelineResult } | { kind: "fallback"; fallback: Fallback };

/**
 * One live run. Resolves with the final result, or with the reason to fall back. Never throws, except for an abort
 * the caller asked for (a newer run, or the page closing), which rejects with an AbortError.
 */
export async function runLive(
  input: { personaId: string; text: string; turnstileToken?: string },
  opts: { vipKey?: string; signal: AbortSignal; handlers: LiveHandlers },
): Promise<LiveOutcome> {
  const timeout = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** (Re)start the idle timer: on sending, and again on every event the stream delivers. */
  const stillAlive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => timeout.abort(), LIVE_TIMEOUT_MS);
  };
  stillAlive();
  const onAbort = () => timeout.abort();
  opts.signal.addEventListener("abort", onAbort);
  try {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/x-ndjson" };
    if (opts.vipKey) headers["x-care-desk-key"] = opts.vipKey;
    let res: Response;
    try {
      res = await fetch(TRY_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        signal: timeout.signal,
        cache: "no-store",
      });
    } catch {
      if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
      return { kind: "fallback", fallback: { kind: "unreachable" } };
    }
    stillAlive();
    const type = res.headers.get("content-type") ?? "";
    if (!res.body || !/ndjson|json/.test(type)) {
      return { kind: "fallback", fallback: res.ok ? { kind: "error" } : { kind: "unreachable" } };
    }
    try {
      for await (const raw of readNdjson(res.body)) {
        const ev = asStepEvent(raw);
        if (!ev) continue;
        stillAlive();
        if (ev.type === "step") opts.handlers.onStep(ev.step);
        else if (ev.type === "done") {
          const result = ev.result;
          return { kind: "done", result };
        } else if (ev.type === "limited") {
          return { kind: "fallback", fallback: { kind: "limited", reason: ev.reason, resetAt: ev.resetAt } };
        } else {
          return { kind: "fallback", fallback: { kind: "error", message: ev.message || undefined } };
        }
      }
    } catch {
      if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
      return { kind: "fallback", fallback: { kind: timeout.signal.aborted ? "unreachable" : "error" } };
    }
    // The stream ended without a result.
    return { kind: "fallback", fallback: { kind: "error" } };
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener("abort", onAbort);
  }
}

/** The message the pipeline sees. The id is local and never sent anywhere. */
export function liveMessage(patientId: string, text: string): PatientMessage {
  return { id: "MSG-TRY", patientId, channel: "chat", receivedAt: new Date().toISOString(), body: text };
}

/**
 * The whole pipeline, run in the browser when the live AI is unavailable: personal details removed and the safety
 * rules first, then the built-in stand-in (the same one the desk's sample results use) sorts and drafts, and the real
 * fact check runs on its sample reply. No AI is called. The pipeline is loaded on demand, so the page stays light.
 */
export async function runInBrowser(patient: Patient, text: string): Promise<{ steps: TrailStep[]; result: PipelineResult }> {
  const { runPipeline, createMockClient } = await import("@/lib/pipeline");
  const steps: TrailStep[] = [];
  const result = await runPipeline(liveMessage(patient.id, text), patient, {
    mode: "deterministic_only",
    fallbackLlm: createMockClient(),
    onStep: (s) => steps.push(s),
  });
  return { steps, result };
}

/** Load the in-browser pipeline ahead of time (after the page settles), so a fallback starts instantly. */
export function preloadBrowserPipeline(): void {
  void import("@/lib/pipeline").catch(() => {});
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** True when the result came from the built-in stand-in for Claude (mock) sorter or drafter. */
export function usedSampleModels(result: PipelineResult): boolean {
  return result.models.sort === "mock" || result.models.draft === "mock";
}

/** True when any model (live or stand-in) ran. False when the safety rules stopped the message before any AI. */
export function usedAnyModel(result: PipelineResult): boolean {
  return Boolean(result.models.sort || result.models.draft);
}

/** "3:00 pm", in the visitor's own time zone. */
export function localClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.?m\.?/i, " $1m").toLowerCase();
}

/** "in 34 min", "in 2 h 5 min". */
export function untilText(iso: string, now = Date.now()): string {
  const min = Math.max(1, Math.ceil((Date.parse(iso) - now) / 60000));
  if (!Number.isFinite(min)) return "";
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}
