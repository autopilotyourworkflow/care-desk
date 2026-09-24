"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { CircleCheck, Mail, MessageCircle, Pause, Play, RotateCcw } from "lucide-react";
import { TrailMini, type MiniCase } from "@/components/trail";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { LoadingStatus, Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/components/ui/cn";
import { useCase, useMeta } from "@/lib/client/data";
import { useSession } from "@/lib/client/session";
import type { CaseFile } from "@/lib/client/types";
import { COUNTRY_LABEL, fillDraftPlaceholders } from "@/lib/format";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  try {
    const mq = window.matchMedia(REDUCED);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  } catch {
    return () => {};
  }
}
function getReduced() {
  try {
    return window.matchMedia(REDUCED).matches;
  } catch {
    return false;
  }
}

/** True when the visitor asked for reduced motion. False on the server and during hydration. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getReduced, () => false);
}

const noSubscribe = () => () => {};
/** False on the server and during hydration, true once the page runs in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

function toMini(c: CaseFile): MiniCase {
  return { message: c.message, patient: { firstName: c.patient.firstName, country: c.patient.country }, result: c.result };
}

/**
 * The two example messages the welcome shows, from meta.json (the same ids resolveWelcomeIds picks from the queue), so
 * the first screen needs only that small file and two case files.
 */
export function useWelcomeCases() {
  const meta = useMeta();
  const routine = useCase(meta.data?.welcome.routine);
  const clinical = useCase(meta.data?.welcome.clinical);
  const error = meta.error ?? routine.error ?? clinical.error;
  const cases = routine.data && clinical.data ? [toMini(routine.data), toMini(clinical.data)] : null;
  const retry = () => {
    meta.retry();
    routine.retry();
    clinical.retry();
  };
  return { cases, error, retry, routine: routine.data };
}

const EXAMPLE_LABELS = ["Order question", "Medication question"] as const;

/**
 * The welcome's live proof, a white card that floats over the hero photo: an order question ticks through to a checked
 * draft, then a medication question stops at the safety rules. Both come from the demo data, through the same checks
 * the desk uses. With reduced motion nothing plays by itself: both end states are one press apart.
 */
export function WelcomeDemo({ className }: { className?: string }) {
  const { cases, error, retry } = useWelcomeCases();
  // The motion preference is not known on the server, so until hydration both layouts are rendered and CSS
  // (motion-reduce:) shows the right one; the first paint then already matches the final layout. After hydration only
  // the one that shows is kept, so the loop never runs hidden.
  const reduced = useReducedMotion();
  const hydrated = useHydrated();
  const showLoop = !hydrated || !reduced;
  const showStatic = !hydrated || reduced;

  let content;
  if (error) {
    content = (
      <div className="flex min-h-[24rem] flex-col items-start justify-center gap-3">
        <p className="text-base font-semibold text-heading">The live example could not load</p>
        <p className="max-w-[40ch] text-sm text-muted">{error.message}</p>
        <Button variant="secondary" size="sm" leadingIcon={RotateCcw} onClick={retry} className="mt-1">
          Try again
        </Button>
      </div>
    );
  } else if (!cases) {
    content = <DemoSkeleton />;
  } else {
    content = (
      <>
        {showLoop && (
          <div className="motion-reduce:hidden">
            <DemoLoop cases={cases} holdMs={4200} />
          </div>
        )}
        {showStatic && (
          <div className="hidden motion-reduce:block">
            <StaticExamples cases={cases} />
          </div>
        )}
      </>
    );
  }

  return (
    <section
      aria-labelledby="welcome-demo-title"
      className={cn("min-w-0 rounded-card bg-surface p-5 shadow-pop ring-1 ring-navy-900/5 sm:p-6", className)}
    >
      <h2 id="welcome-demo-title" className="sr-only">
        Two example messages, run through the checks
      </h2>
      {content}
    </section>
  );
}

/** The patient's message, as it arrived. */
function MessageFigure({ c, className }: { c: MiniCase; className?: string }) {
  const Channel = c.message.channel === "email" ? Mail : MessageCircle;
  return (
    <figure className={cn("rounded-control bg-inset p-3.5", className)}>
      <figcaption className="mb-1.5 flex items-center gap-2 text-xs text-muted">
        <Channel aria-hidden size={13} className="shrink-0 text-muted-icon" />
        <span className="font-semibold text-heading">{c.patient ? c.patient.firstName : "A patient"}</span>
        <span>{c.patient ? COUNTRY_LABEL[c.patient.country] : ""}</span>
      </figcaption>
      <blockquote className="line-clamp-2 text-sm text-ink">{c.message.body}</blockquote>
    </figure>
  );
}

/** The draft as a person would read it: names filled in, citation markers left out. Null without a checked draft. */
function draftExcerpt(c: MiniCase, agentName: string): string | null {
  const d = c.result.draft;
  if (!d?.text || d.declined || !c.result.check?.passed) return null;
  return fillDraftPlaceholders(d.text, c.patient?.firstName, agentName)
    .replace(/\s*\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSafety(c: MiniCase): boolean {
  return c.result.route === "clinician" || c.result.route === "urgent";
}

/** The line under a safety stop: the trail's own outcome line already says a clinician answers. */
function safetyNote(c: MiniCase): string {
  return `The clinician sees the words that stopped it${c.result.holdOrders ? ", and the patient's orders go on hold" : ""}.`;
}

/**
 * The payoff under the trail: the first lines of the checked draft, or for a safety stop, what the clinician gets.
 * Both take the same space, so the loop does not jump between examples.
 */
function Payoff({ c, agentName, shown }: { c: MiniCase; agentName: string; shown: boolean }) {
  const excerpt = draftExcerpt(c, agentName);
  return (
    <div aria-hidden className={cn("mt-3 min-h-[5.5rem] transition-opacity duration-200", shown ? "opacity-100" : "opacity-0")}>
      {excerpt ? (
        <figure className="rounded-control bg-success-bg/45 p-3.5">
          <figcaption className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>Draft, waiting for a person to send</span>
            <Chip tone="success" icon={CircleCheck}>
              Facts checked
            </Chip>
          </figcaption>
          <p className="line-clamp-2 text-sm text-ink">{excerpt}</p>
        </figure>
      ) : isSafety(c) ? (
        <p className="rounded-control border border-dashed border-line-strong p-3.5 text-sm text-muted">{safetyNote(c)}</p>
      ) : null}
    </div>
  );
}

/** For screen readers: the payoff in one sentence, since the visual version is decorative. */
function payoffText(c: MiniCase, agentName: string): string {
  const excerpt = draftExcerpt(c, agentName);
  if (excerpt) return `Draft reply, facts checked, waiting for a person to send: ${excerpt}`;
  if (isSafety(c)) return `No draft is written. ${safetyNote(c)}`;
  return "";
}

/**
 * Runs each case in turn, holds on the outcome with the drafted words, then moves on. Pausable (WCAG 2.2.2), and
 * paused while hovered or focused.
 */
function DemoLoop({ cases, holdMs }: { cases: MiniCase[]; holdMs: number }) {
  const { staff } = useSession();
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const c = cases[index % cases.length];

  useEffect(() => {
    if (!done || paused || hovered || cases.length < 2) return;
    const t = window.setTimeout(() => {
      setDone(false);
      setIndex((i) => (i + 1) % cases.length);
      setRun((r) => r + 1);
    }, holdMs);
    return () => window.clearTimeout(t);
  }, [done, paused, hovered, holdMs, cases.length]);

  if (!c) return null;

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-medium text-muted">
          <span aria-hidden className="size-2 rounded-pill bg-success-icon" />
          Live example {(index % cases.length) + 1} of {cases.length}
        </p>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className="-mr-2 inline-flex h-8 items-center gap-1.5 rounded-inner px-2.5 text-xs font-medium text-heading transition-colors duration-150 hover:bg-field active:bg-field-hover"
        >
          {paused ? <Play aria-hidden size={14} /> : <Pause aria-hidden size={14} />}
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <ReservedHeight cases={cases} agentName={staff.name}>
        <MessageFigure key={`msg-${index}-${run}`} c={c} className="mb-4 animate-rise-in" />
        <TrailMini key={`trail-${index}-${run}`} result={c.result} tone="light" animate replayKey={run} onDone={() => setDone(true)} />
        <Payoff key={`payoff-${index}-${run}`} c={c} agentName={staff.name} shown={done} />
        {done && <p className="sr-only">{payoffText(c, staff.name)}</p>}
      </ReservedHeight>
    </div>
  );
}

/** Reduced motion: both examples at their end state, one press apart. Nothing moves on its own. */
function StaticExamples({ cases }: { cases: MiniCase[] }) {
  const { staff } = useSession();
  const [index, setIndex] = useState(0);
  const c = cases[index] ?? cases[0];
  if (!c) return null;
  return (
    <div>
      <div role="group" aria-label="Choose an example" className="mb-3 inline-flex rounded-control bg-field p-1">
        {cases.map((x, i) => (
          <button
            key={x.message.id}
            type="button"
            aria-pressed={i === index}
            onClick={() => setIndex(i)}
            className={cn(
              "h-8 rounded-inner px-3 text-xs font-medium transition-colors duration-150",
              i === index ? "bg-surface text-heading shadow-card" : "text-muted hover:text-heading",
            )}
          >
            {EXAMPLE_LABELS[i] ?? `Example ${i + 1}`}
          </button>
        ))}
      </div>
      <ReservedHeight cases={cases} agentName={staff.name}>
        <MessageFigure c={c} className="mb-4" />
        <TrailMini key={c.message.id} result={c.result} tone="light" animate={false} />
        <Payoff c={c} agentName={staff.name} shown />
        <p className="sr-only" aria-live="polite">
          {payoffText(c, staff.name)}
        </p>
      </ReservedHeight>
    </div>
  );
}

/**
 * Holds the card at the height of its tallest example. Every example's end state is laid out, invisible, in the same
 * grid cell as the live one, so the cell is always as tall as the tallest and the page under the hero never moves as
 * the loop switches between an order question (with its draft) and a medication question (without one).
 */
function ReservedHeight({ cases, agentName, children }: { cases: MiniCase[]; agentName: string; children: ReactNode }) {
  return (
    <div className="grid">
      {cases.map((x) => (
        <div key={`ghost-${x.message.id}`} aria-hidden inert className="invisible [grid-area:1/1]">
          <MessageFigure c={x} className="mb-4" />
          <TrailMini result={x.result} tone="light" animate={false} />
          <Payoff c={x} agentName={agentName} shown />
        </div>
      ))}
      <div className="min-w-0 [grid-area:1/1]">{children}</div>
    </div>
  );
}

/** Keeps the card's footprint while the two examples load. */
function DemoSkeleton() {
  return (
    <div aria-busy="true">
      <LoadingStatus label="Loading the live example" />
      <div aria-hidden>
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-3 w-32" rounded="pill" />
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="mb-4 h-[4.75rem]" rounded="inner" />
        <ul className="flex flex-col gap-2.5">
          {[72, 48, 64, 44, 50, 46, 58].map((w, i) => (
            <li key={i} className="flex items-center gap-3">
              <Skeleton className="size-5 shrink-0" rounded="pill" />
              <span className="block" style={{ width: `${w}%` }}>
                <Skeleton className="h-3" rounded="pill" />
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 h-12 border-t border-line-cool" />
        <Skeleton className="mt-3 h-[5.5rem]" />
      </div>
    </div>
  );
}
