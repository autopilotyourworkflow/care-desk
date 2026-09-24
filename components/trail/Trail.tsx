"use client";

import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Hand,
  LoaderCircle,
  Minus,
  Stethoscope,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import type { PipelineResult, StepId, ThreadEntry, TrailStep } from "@/lib/types";
import { aiCostText, formatMs, formatVersion, shortPhrase } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { HoldBadge, LockBadge, RiskBadge } from "@/components/ui/RiskBadge";
import {
  CheckEvidence,
  DraftEvidence,
  RedactEvidence,
  RulesEvidence,
  SortEvidence,
  SourcesEvidence,
  type DraftNames,
} from "./evidence";
import {
  AFTER_STOP_TITLE,
  afterStopSummary,
  isResting,
  lockedVerdict,
  splitSampleNote,
  stopReason,
  usedStandIn,
  verdictText,
  type TrailLock,
} from "./outcome";
import { displayStateFor, normalizeTrail, stopIndex, useReveal, type DisplayState } from "./reveal";

export interface TrailProps {
  result: PipelineResult;
  /** Reveal the steps in sequence (about 120 ms apart). The stop halts the sequence visibly. Reduced motion: end state. */
  animate?: boolean;
  /** Tighter spacing and smaller type, for narrow columns. Still expandable. */
  compact?: boolean;
  /** Rendered inside the decide step, e.g. Send / Edit / Escalate. */
  actions?: ReactNode;
  /** Steps expanded on first render. */
  defaultOpen?: StepId[];
  /**
   * The original message text. Lets the rules step show the matched words highlighted in their sentence.
   * Without it only the matched phrase is shown.
   */
  messageText?: string;
  /**
   * The first line of messageText is an email subject (messageText() joins subject and body with a blank line).
   * Matches on that line are labelled "Subject:". Defaults to a guess from the text's shape.
   */
  subject?: boolean;
  /** Earlier messages in the conversation. Lets a rule hit from an earlier message show in its own sentence. */
  thread?: ThreadEntry[];
  /**
   * The patient's first name and the signed-in person's name. The draft is shown with "Hi [FIRST_NAME]," and
   * "[AGENT_NAME]" filled in; without names they show as fill-in tokens. The fact check always runs on the raw text.
   */
  names?: DraftNames;
  /** A live run still streaming: the first pending step shows as working. */
  running?: boolean;
  /** Heading above the trail. Pass false to hide the header row. */
  title?: string | false;
  /** Called when the animated reveal finishes. */
  onAnimationComplete?: () => void;
  /** Change this to replay the animation for the same result. */
  replayKey?: unknown;
  /**
   * A patient-level lock from the desk queue (pass QueueItem.lock). Another message from this patient reports a death
   * or something urgent, so the header reads "Held: clinician first" or "Withdrawn" instead of the per-message
   * verdict, which cannot know.
   */
  lock?: TrailLock;
  /**
   * The earlier messages in the conversation exactly as the AI was given them (redacted, see redactThread in
   * lib/pipeline). Shown under "See what the AI saw" with the message itself.
   */
  aiThread?: Pick<ThreadEntry, "from" | "body">[];
  className?: string;
}

const EXPANDABLE: StepId[] = ["redact", "rules", "sort", "sources", "draft", "check"];

function hasEvidence(step: TrailStep, result: PipelineResult): boolean {
  if (!EXPANDABLE.includes(step.id)) return false;
  if (step.status === "skipped" || step.status === "pending") return false;
  switch (step.id) {
    case "sort":
      return Boolean(result.sort);
    case "sources":
      return Boolean(result.sources);
    case "draft":
      return Boolean(result.draft);
    case "check":
      return Boolean(result.check);
    default:
      return true;
  }
}

type StopTone = "clinician" | "urgent";

/**
 * The check trail: what happened to a message, step by step, ending at a person's decision. Each step expands inline
 * to show its evidence. A safety stop halts the trail with "Stopped here", the reason and any order hold; later steps
 * settle as skipped.
 */
export function Trail({
  result,
  animate = false,
  compact = false,
  actions,
  defaultOpen = [],
  messageText,
  subject,
  thread,
  names,
  running = false,
  title = "Check trail",
  onAnimationComplete,
  replayKey,
  lock,
  aiThread,
  className,
}: TrailProps) {
  const base = useId();
  const steps = useMemo(() => normalizeTrail(result.trail), [result.trail]);
  const stopAt = stopIndex(steps);
  const shown = useReveal(result, animate, onAnimationComplete, replayKey);
  const animating = animate && shown < steps.length;
  const [open, setOpen] = useState<Set<StepId>>(() => new Set(defaultOpen));
  const [highlight, setHighlight] = useState<string | null>(null);
  const stopTone: StopTone = result.route === "urgent" ? "urgent" : "clinician";

  const expandable = steps.filter((s) => hasEvidence(s, result)).map((s) => s.id);
  const allOpen = expandable.length > 0 && expandable.every((id) => open.has(id));

  const toggle = useCallback((id: StepId) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const anchor = useCallback((sid: string) => `${base}-src-${sid.replace(/[^A-Za-z0-9_-]/g, "_")}`, [base]);

  const cite = useCallback(
    (sid: string) => {
      setOpen((prev) => new Set(prev).add("sources"));
      setHighlight(sid);
      window.setTimeout(() => {
        const el = document.getElementById(anchor(sid));
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        el?.focus({ preventScroll: true });
      }, 220);
      window.setTimeout(() => setHighlight((h) => (h === sid ? null : h)), 2400);
    },
    [anchor],
  );

  const totalMs = steps.reduce((n, s) => n + (s.ms ?? 0), 0);

  return (
    <section
      aria-label={title || "Check trail"}
      aria-busy={animating || running || undefined}
      className={cn("min-w-0 text-sm", className)}
    >
      {title !== false && (
        <div className={compact ? "mb-3" : "mb-4"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className={cn("font-semibold text-heading", compact ? "text-sm" : "text-base")}>{title}</h2>
            {totalMs > 0 && !animating && !running && (
              <span className="text-xs text-muted tnum">{checkedInText(totalMs)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Only a real fallback: a sample run with the built-in stand-in for Claude is not "resting". */}
            {isResting(result) && (
              <span className="inline-flex h-6 items-center gap-1 rounded-pill bg-warning-bg px-2.5 text-xs font-semibold text-warning-fg">
                <TriangleAlert aria-hidden size={13} /> AI resting: rules only
              </span>
            )}
            {expandable.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen(allOpen ? new Set() : new Set(expandable))}
                className="-mr-1.5 inline-flex h-8 items-center rounded-inner px-2 text-xs font-medium text-heading transition-colors duration-150 hover:bg-navy-900/[0.06] active:bg-navy-900/10"
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            )}
          </div>
        </div>
        {/* The verdict: what happened, in one line. Space is kept while the trail runs, so nothing jumps. */}
        <p
          aria-hidden={animating || running || undefined}
          className={cn(
            "mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 transition-opacity duration-200",
            animating || running ? "invisible opacity-0" : "opacity-100",
          )}
        >
          {lock ? <LockBadge kind={lock.kind} /> : <RiskBadge route={result.route} />}
          {result.holdOrders && <HoldBadge />}
          <span className={cn("font-medium text-ink", compact ? "text-xs" : "text-sm")}>
            {lock ? lockedVerdict(lock) : verdictText(result)}
          </span>
        </p>
        </div>
      )}

      <ol className="relative">
        {steps.map((step, i) => {
          const state = displayStateFor(steps, i, shown, animating, running, stopAt);
          const next = steps[i + 1];
          const nextState = next ? displayStateFor(steps, i + 1, shown, animating, running, stopAt) : null;
          return (
            <StepRow
              key={step.id}
              step={step}
              state={state}
              nextState={nextState}
              isLast={i === steps.length - 1}
              result={result}
              compact={compact}
              stopTone={stopTone}
              open={open.has(step.id)}
              onToggle={() => toggle(step.id)}
              expandable={!animating && hasEvidence(step, result)}
              contentId={`${base}-step-${step.id}`}
              messageText={messageText}
              subject={subject}
              thread={thread}
              names={names}
              aiThread={aiThread}
              afterStop={stopAt >= 0 && i > stopAt}
              actions={step.id === "decide" ? actions : undefined}
              anchor={anchor}
              highlight={highlight}
              onCite={cite}
            />
          );
        })}
      </ol>

      {!compact && !animating && !running && result.versions.rules && (
        <p className="mt-4 border-t border-line-cool pt-3 text-xs text-muted tnum">
          Rules {formatVersion(result.versions.rules)}, prompts {formatVersion(result.versions.prompts)},{" "}
          {usedStandIn(result) ? "sample run without Claude" : aiCostText(result.usage, result.models)}
        </p>
      )}
    </section>
  );
}

/** The header total in plain words: "Checked in under a second", "Checked in 3.4 s". */
function checkedInText(ms: number): string {
  return ms < 1000 ? "Checked in under a second" : `Checked in ${formatMs(ms)}`;
}

/** One step's time inside its evidence: "under 1 ms" rather than a "0 ms" that reads as "did not run". */
function stepTimeText(ms: number): string {
  return ms < 1 ? "under 1 ms" : formatMs(ms);
}

// ---------------------------------------------------------------------------

const STATUS_WORD: Record<DisplayState, string> = {
  passed: "Passed",
  stopped: "Stopped here",
  flagged: "Flagged",
  skipped: "Skipped",
  failed: "Blocked",
  pending: "Waiting",
  working: "Working",
  awaiting: "Waiting for a person",
};

export function StatusIcon({
  state,
  stopTone,
  size = "md",
  tone = "light",
  clinician = false,
  neutral = false,
}: {
  state: DisplayState;
  /** Accepted for backwards compatibility; the icon depends on the state only. */
  stepId?: StepId;
  stopTone: StopTone;
  size?: "sm" | "md";
  tone?: "light" | "navy";
  /** The deciding person is a clinician (safety routes): shows a stethoscope instead of a person. */
  clinician?: boolean;
  /** A passed check drawn without the success green, for a check that ran after a safety stop. */
  neutral?: boolean;
}) {
  const box = size === "md" ? "size-7" : "size-5";
  const ic = size === "md" ? 15 : 12;
  const onNavy = tone === "navy";
  let cls = "";
  let icon: ReactNode = null;
  switch (state) {
    case "passed":
      cls = neutral
        ? onNavy
          ? "bg-white/15 text-white"
          : "bg-navy-100 text-muted"
        : onNavy
          ? "bg-[#1f6f4a] text-[#d7f2e0]"
          : "bg-success-bg text-success-fg";
      icon = <Check aria-hidden size={ic} strokeWidth={2.5} />;
      break;
    case "stopped":
      cls = onNavy
        ? cn("bg-white", stopTone === "urgent" ? "text-urgent-solid" : "text-clinician-fg")
        : cn(stopTone === "urgent" ? "bg-urgent-solid" : "bg-clinician-fg", "text-white");
      icon = <Hand aria-hidden size={ic} />;
      break;
    case "failed":
      cls = onNavy ? "bg-urgent-solid text-white" : "bg-error-bg text-error-fg";
      icon = <X aria-hidden size={ic} strokeWidth={2.5} />;
      break;
    case "flagged":
      cls = "bg-warning-bg text-warning-fg";
      icon = <TriangleAlert aria-hidden size={ic - 1} />;
      break;
    case "skipped":
      cls = onNavy
        ? "border border-dashed border-white/30 text-on-navy-muted"
        : "border border-dashed border-line-strong bg-surface text-muted-icon";
      icon = <Minus aria-hidden size={ic - 2} />;
      break;
    case "working":
      cls = onNavy ? "border border-white/40 text-white" : "border border-navy-200 bg-surface text-navy-900";
      icon = <LoaderCircle aria-hidden size={ic} className="animate-spin" />;
      break;
    case "awaiting":
      cls = onNavy ? "bg-white text-navy-900" : "bg-navy-900 text-white";
      icon = clinician ? <Stethoscope aria-hidden size={ic} /> : <UserRound aria-hidden size={ic} />;
      break;
    case "pending":
    default:
      cls = onNavy ? "border border-white/20" : "border border-line-strong bg-surface";
      icon = <span aria-hidden className={cn("size-1.5 rounded-pill", onNavy ? "bg-white/40" : "bg-line-strong")} />;
  }
  return (
    <span
      key={state}
      className={cn(
        "relative z-10 inline-flex shrink-0 items-center justify-center rounded-pill",
        box,
        cls,
        state !== "pending" && state !== "working" && "animate-tick",
      )}
    >
      {icon}
    </span>
  );
}

function connectorClass(state: DisplayState, next: DisplayState | null, afterStop = false): string {
  if (!next) return "";
  // Everything after a stop stays on the dashed spine, a check that still ran included.
  if (afterStop || state === "stopped" || next === "skipped" || state === "skipped")
    return "border-l-2 border-dashed border-line-strong";
  if (state === "passed" && next !== "pending" && next !== "working") return "border-l-2 border-success-icon/45";
  if (state === "failed") return "border-l-2 border-error-fg/35";
  return "border-l-2 border-line-cool";
}

interface StepRowProps {
  step: TrailStep;
  state: DisplayState;
  nextState: DisplayState | null;
  isLast: boolean;
  result: PipelineResult;
  compact: boolean;
  stopTone: StopTone;
  open: boolean;
  onToggle: () => void;
  expandable: boolean;
  contentId: string;
  messageText?: string;
  subject?: boolean;
  thread?: ThreadEntry[];
  names?: DraftNames;
  aiThread?: Pick<ThreadEntry, "from" | "body">[];
  /** This step comes after the step where the trail stopped. */
  afterStop: boolean;
  actions?: ReactNode;
  anchor: (sid: string) => string;
  highlight: string | null;
  onCite: (sid: string) => void;
}

function StepRow({
  step,
  state,
  nextState,
  isLast,
  result,
  compact,
  stopTone,
  open,
  onToggle,
  expandable,
  contentId,
  messageText,
  subject,
  thread,
  names,
  aiThread,
  afterStop,
  actions,
  anchor,
  highlight,
  onCite,
}: StepRowProps) {
  const revealed = state !== "pending" && state !== "working";
  const isDecide = step.id === "decide";
  const safetyRoute = result.route === "clinician" || result.route === "urgent";
  // A check that still ran after the stop (the sorter looking for anything more urgent) is part of the stop: a
  // neutral icon, quiet text and its own title, never a green pass that reads as the message carrying on.
  const checkedAfterStop = afterStop && state === "passed" && !isDecide;
  const quiet = state === "skipped" || state === "pending" || checkedAfterStop;
  // The pipeline's "Sample run" sentence becomes a small tag, so it is not repeated on every row.
  const { text: stepSummary, sample } = splitSampleNote(step.summary);

  // After a stop, skipped rows stay short; only the draft slot says plainly that no AI reply exists.
  let summary = checkedAfterStop ? afterStopSummary(stepSummary) : stepSummary;
  if (state === "skipped" && afterStop) summary = "Skipped after the stop";
  if (step.id === "draft" && state === "skipped" && safetyRoute) summary = "No AI reply for this one. A clinician will answer.";
  if (!revealed) summary = state === "working" ? "Working" : "Waiting";

  const titleRow = (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            "font-semibold transition-colors duration-200",
            compact ? "text-sm" : "text-sm",
            quiet ? "text-muted" : "text-heading",
          )}
        >
          {checkedAfterStop ? AFTER_STOP_TITLE : step.title}
        </span>
        {state === "stopped" && (
          <span
            className={cn(
              "inline-flex h-5 items-center rounded-pill px-2 text-2xs font-semibold text-white",
              stopTone === "urgent" ? "bg-urgent-solid" : "bg-clinician-fg",
            )}
          >
            Stopped here
          </span>
        )}
        {state === "failed" && (
          <span className="inline-flex h-5 items-center rounded-pill bg-error-bg px-2 text-2xs font-semibold text-error-fg">
            Blocked
          </span>
        )}
        {state === "flagged" && (
          <span className="inline-flex h-5 items-center rounded-pill bg-warning-bg px-2 text-2xs font-semibold text-warning-fg">
            Flagged
          </span>
        )}
        {sample && revealed && state !== "skipped" && (
          <span className="inline-flex h-5 items-center rounded-pill bg-field px-2 text-2xs font-semibold text-muted">
            Sample<span className="sr-only">: done by a simple built-in stand-in, not Claude</span>
          </span>
        )}
        <span className="sr-only">, {checkedAfterStop ? "Checked" : STATUS_WORD[state]}</span>
      </span>
      <span
        key={revealed ? "on" : "off"}
        className={cn(
          "mt-0.5",
          compact || state === "skipped" || checkedAfterStop ? "text-xs" : "text-sm",
          quiet || !revealed ? "text-muted" : "text-ink",
          revealed && "animate-rise-in",
        )}
      >
        {summary}
      </span>
    </span>
  );

  const aside = (
    <span className="flex shrink-0 items-center gap-1.5 pl-2 pt-0.5">
      {expandable && (
        <ChevronDown
          aria-hidden
          size={16}
          className={cn("text-muted-icon transition-transform duration-200 ease-out-expo", open && "rotate-180")}
        />
      )}
    </span>
  );

  return (
    <li className={cn("relative flex gap-3", !isLast && (compact ? "pb-3" : "pb-4"))}>
      {/* connector from this icon to the next */}
      {!isLast && (
        <span
          aria-hidden
          className={cn(
            "absolute bottom-0 left-[13px] top-7 transition-colors duration-200",
            connectorClass(state, nextState, afterStop),
          )}
        />
      )}
      <StatusIcon state={state} stopTone={stopTone} clinician={isDecide && safetyRoute} neutral={checkedAfterStop} />

      <div className="min-w-0 flex-1 pt-0.5">
        {expandable ? (
          <h3 className="text-sm">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={contentId}
              onClick={onToggle}
              className="-mx-2 -my-1 flex w-[calc(100%+1rem)] items-start rounded-inner px-2 py-1 text-left transition-colors duration-150 hover:bg-navy-900/[0.04] active:bg-navy-900/[0.07]"
            >
              {titleRow}
              {aside}
            </button>
          </h3>
        ) : (
          <h3 className="flex items-start text-sm">
            {titleRow}
            {aside}
          </h3>
        )}

        {state === "stopped" && <StopBox result={result} tone={stopTone} />}
        {state === "failed" && step.id === "check" && <BlockedBox result={result} />}

        {/* On phones the evidence spans under the icon column, so it gets the card's full width. The margin sits on
            the collapsible itself, because its inner wrapper clips overflow. */}
        {expandable && (
          <div id={contentId} className="collapsible max-sm:-ml-10" data-open={open} inert={!open}>
            <div>
              <div className={cn("relative rounded-inner bg-inset p-3", compact ? "mt-2" : "mt-2.5")}>
                <Evidence
                  step={step.id}
                  result={result}
                  messageText={messageText}
                  subject={subject}
                  thread={thread}
                  names={names}
                  aiThread={aiThread}
                  anchor={anchor}
                  highlight={highlight}
                  onCite={onCite}
                />
                {step.ms != null && <p className="mt-3 text-xs text-muted tnum">Step time: {stepTimeText(step.ms)}</p>}
              </div>
            </div>
          </div>
        )}

        {isDecide && state === "awaiting" && (
          <DecideBody result={result} actions={actions} compact={compact} />
        )}
      </div>
    </li>
  );
}

function Evidence({
  step,
  result,
  messageText,
  subject,
  thread,
  names,
  aiThread,
  anchor,
  highlight,
  onCite,
}: {
  step: StepId;
  result: PipelineResult;
  messageText?: string;
  subject?: boolean;
  thread?: ThreadEntry[];
  names?: DraftNames;
  aiThread?: Pick<ThreadEntry, "from" | "body">[];
  anchor: (sid: string) => string;
  highlight: string | null;
  onCite: (sid: string) => void;
}) {
  switch (step) {
    case "redact":
      return <RedactEvidence result={result} aiThread={aiThread} />;
    case "rules":
      return <RulesEvidence result={result} messageText={messageText} subject={subject} thread={thread} />;
    case "sort":
      return <SortEvidence result={result} />;
    case "sources":
      return <SourcesEvidence result={result} anchor={anchor} highlighted={highlight} />;
    case "draft":
      return <DraftEvidence result={result} onCite={onCite} names={names} />;
    case "check":
      return <CheckEvidence result={result} />;
    default:
      return null;
  }
}

function StopBox({ result, tone }: { result: PipelineResult; tone: StopTone }) {
  // One entry per distinct phrase, dropping any phrase that is only part of a longer one ("passed away" inside "My dad passed away").
  const unique = Array.from(new Set(result.rules.hits.map((h) => h.phrase)));
  const phrases = unique.filter(
    (p) => !unique.some((o) => o !== p && o.length > p.length && o.toLowerCase().includes(p.toLowerCase())),
  );
  return (
    <div
      role="note"
      className={cn("mt-2 rounded-inner p-3 animate-rise-in", tone === "urgent" ? "bg-urgent-bg" : "bg-clinician-bg")}
    >
      <p className={cn("text-sm font-semibold", tone === "urgent" ? "text-urgent-fg" : "text-clinician-fg")}>
        {stopReason(result)}
      </p>
      <p className="mt-0.5 text-sm text-ink">
        {tone === "urgent" ? "Top of the clinician queue." : "Sent to the clinician queue."}
      </p>
      {phrases.length > 0 && (
        <p className="mt-1.5 text-xs text-ink">
          Triggered by{" "}
          {phrases.map((p, i) => (
            <span key={p}>
              {i > 0 && (i === phrases.length - 1 ? " and " : ", ")}
              <q className="font-semibold">{shortPhrase(p)}</q>
            </span>
          ))}
        </p>
      )}
      {result.holdOrders && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <HoldBadge />
          <span className="text-xs text-ink">Nothing ships until a clinician resumes the orders.</span>
        </div>
      )}
    </div>
  );
}

function BlockedBox({ result }: { result: PipelineResult }) {
  const missing = result.check?.facts.filter((f) => !f.found) ?? [];
  const banned = result.check?.banned ?? [];
  return (
    <div role="note" className="mt-2 rounded-inner bg-error-bg p-3 animate-rise-in">
      <p className="text-sm font-semibold text-error-fg">Draft blocked</p>
      <p className="mt-0.5 text-sm text-ink">
        {missing.length > 0 && (
          <>
            {missing.map((f, i) => (
              <span key={f.text + i}>
                {i > 0 && ", "}
                <q className="font-semibold">{f.text}</q>
              </span>
            ))}{" "}
            {missing.length === 1 ? "is" : "are"} not in the sources.{" "}
          </>
        )}
        {banned.length > 0 && <>Not allowed: {banned.join(", ")}. </>}
        A person writes this reply.
      </p>
    </div>
  );
}

function DecideBody({ actions, compact }: { result: PipelineResult; actions?: ReactNode; compact: boolean }) {
  if (!actions) return null;
  return (
    <div className={cn("animate-rise-in", compact ? "mt-2" : "mt-3")}>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
