"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, Info, KeyRound, Lock, MessageCircle, Play, RotateCcw, Stethoscope } from "lucide-react";
import type { PipelineResult, StepId } from "@/lib/types";
import type { Persona } from "@/lib/client/types";
import { usePersonas } from "@/lib/client/data";
import { useSession } from "@/lib/client/session";
import { AppShell, PageHeader, DEFAULT_SHORTCUTS, type ShortcutGroup } from "@/components/shell";
import { Avatar, Button, Card, Chip, Field, KeyCombo, Notice, TextArea, cn } from "@/components/ui";
import { StatusIcon, Trail, partialResult } from "@/components/trail";
import { STEP_LABEL, formatNumber } from "@/lib/format";
import { prefersReducedMotion } from "@/components/trail/reveal";
import { PersonaPicker, PersonaPickerSkeleton, PersonaRecord } from "./PersonaPicker";
import { examplesFor, exampleForText, idiomNote, shortName } from "./examples";
import { MAX_CHARS, charCount, normaliseText, preloadBrowserPipeline, usedAnyModel, usedSampleModels, type Fallback } from "./live";
import { useLiveRun, type RunState } from "./useLiveRun";
import { FAILED_BODY, FAILED_TITLE, fallbackCopy, isStoppedByRules, runAnnouncement } from "./announce";
import { TurnstileBox, TURNSTILE_SITE_KEY, useVipKey, type TurnstileHandle } from "./access";

const TRY_SHORTCUTS: ShortcutGroup[] = [
  { title: "Try a message", items: [{ keys: ["Ctrl", "Enter"], label: "Run the checks (Cmd on a Mac)" }] },
  ...DEFAULT_SHORTCUTS.filter((g) => g.title === "Anywhere"),
];

const STEPS: StepId[] = ["redact", "rules", "sort", "sources", "draft", "check", "decide"];

const DEFAULT_PERSONA = "PT-1001";

export function TryPage() {
  const personas = usePersonas();
  const vipKey = useVipKey();
  const { staffFor } = useSession();
  const turnstile = useRef<TurnstileHandle>(null);
  const takeTurnstileToken = useCallback(() => turnstile.current?.take(), []);
  const { state, run } = useLiveRun({ vipKey, takeTurnstileToken });

  const [personaId, setPersonaId] = useState(DEFAULT_PERSONA);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Bumped on every failed submit, so the focus moves back to the box even when the error text is unchanged. */
  const [errorTick, setErrorTick] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);

  const list = personas.data?.personas ?? [];
  const persona: Persona | undefined = list.find((p) => p.patient.id === personaId) ?? list[0];
  const examples = useMemo(() => examplesFor(persona?.patient.id ?? DEFAULT_PERSONA), [persona?.patient.id]);
  const count = charCount(text);
  const running = state.phase === "running";

  // Focus the box only after the error has rendered, so it is read out with the error (aria-invalid, described by it).
  useEffect(() => {
    if (errorTick > 0) inputRef.current?.focus();
  }, [errorTick]);

  // Warm the in-browser pipeline once the page has settled, so a fallback starts at once.
  useEffect(() => {
    const t = window.setTimeout(preloadBrowserPipeline, 1500);
    return () => window.clearTimeout(t);
  }, []);

  const choosePersona = (id: string) => {
    // Swap the routine example for the new patient's own, so the draft has something real to cite.
    const before = examplesFor(personaId).find((e) => e.id === "routine");
    const after = examplesFor(id).find((e) => e.id === "routine");
    if (before && after && normaliseText(text) === before.text) setText(after.text);
    setPersonaId(id);
  };

  const scrollToTrail = () => {
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    window.requestAnimationFrame(() =>
      trailRef.current?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" }),
    );
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (running || !persona) return;
    const clean = normaliseText(text);
    if (!clean) {
      setError("Type a message first, or pick one of the examples.");
      setErrorTick((n) => n + 1);
      return;
    }
    if (charCount(clean) > MAX_CHARS) {
      setError(`Keep it to ${formatNumber(MAX_CHARS)} characters or fewer.`);
      setErrorTick((n) => n + 1);
      return;
    }
    setError(null);
    void run({ patient: persona.patient, text: clean });
    scrollToTrail();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  const pickExample = (value: string) => {
    setText(value);
    setError(null);
    inputRef.current?.focus();
  };

  const writeAnother = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
    if (window.matchMedia("(max-width: 1023px)").matches) {
      inputRef.current?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  };

  const agentName = staffFor("agent").name;
  const announcement = runAnnouncement(state);

  return (
    <AppShell shortcuts={TRY_SHORTCUTS}>
      <PageHeader
        title="Try a message"
        description="Write as one of three fictional patients and watch each check run live."
        meta={
          vipKey ? (
            <Chip tone="success" icon={KeyRound}>
              Private link
            </Chip>
          ) : undefined
        }
      />

      {/* One live region for the whole run, mounted from the first render: only its text changes, so each step and the
          result are read once. The notices in the trail are plain content. */}
      <p role="status" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] xl:gap-8">
        {/* ---------------- Composer ---------------- */}
        <Card as="section" aria-labelledby="try-compose" className="min-w-0">
          <h2 id="try-compose" className="sr-only">
            Your message
          </h2>
          <form onSubmit={submit} noValidate className="flex flex-col gap-6">
            {personas.status === "error" ? (
              <Notice
                tone="error"
                title="The sample patients did not load"
                role="alert"
                actions={
                  <Button size="sm" variant="secondary" leadingIcon={RotateCcw} onClick={personas.retry}>
                    Try again
                  </Button>
                }
              >
                {personas.error?.message ?? "Check your connection and try again."}
              </Notice>
            ) : persona ? (
              <div className="flex flex-col gap-2">
                <PersonaPicker personas={list} value={persona.patient.id} onChange={choosePersona} />
                <PersonaRecord key={persona.patient.id} persona={persona} />
              </div>
            ) : (
              <PersonaPickerSkeleton />
            )}

            <div className="flex flex-col gap-3">
              <Field
                label="Message"
                hint={
                  <span className="inline-flex items-start gap-1.5">
                    <Lock aria-hidden size={13} className="mt-[3px] shrink-0 text-muted-icon" />
                    <span>
                      {privacyLine(state)}
                    </span>
                  </span>
                }
                error={error ?? undefined}
                aside={`${formatNumber(count)} / ${formatNumber(MAX_CHARS)}`}
              >
                <TextArea
                  ref={inputRef}
                  data-tour="try-input"
                  rows={4}
                  autoGrow
                  maxLength={MAX_CHARS}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={persona ? `Type ${persona.patient.firstName}'s message here` : "Type a message here"}
                  spellCheck
                  autoComplete="off"
                />
              </Field>

              <div>
                <p id="try-examples" className="mb-2 text-xs font-medium text-muted">
                  Or start from an example
                </p>
                <div role="group" aria-labelledby="try-examples" className="flex flex-wrap gap-2">
                  {examples.map((ex) => (
                    <Button
                      key={ex.id}
                      size="sm"
                      variant={normaliseText(text) === ex.text ? "secondary" : "subtle"}
                      aria-pressed={normaliseText(text) === ex.text}
                      onClick={() => pickExample(ex.text)}
                      disabled={!persona}
                    >
                      {ex.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <TurnstileBox ref={turnstile} enabled={Boolean(TURNSTILE_SITE_KEY) && !vipKey} />

            <div className="flex flex-col gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  size="lg"
                  leadingIcon={Play}
                  loading={running}
                  loadingLabel="Running the checks"
                  disabled={!persona}
                  shortcut={<KeyCombo keys={["Ctrl", "Enter"]} tone="onDark" />}
                  className="max-sm:flex-1"
                >
                  {running ? "Running" : "Run the checks"}
                </Button>
                {text.length > 0 && !running && (
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={() => {
                      setText("");
                      setError(null);
                      inputRef.current?.focus();
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted">
                Live tries are limited each hour, and if the live AI is resting, the checks still run in your browser.
              </p>
            </div>
          </form>
        </Card>

        {/* ---------------- Live trail ---------------- */}
        <div ref={trailRef} className="min-w-0 scroll-mt-2">
          <Card as="section" aria-label="Live trail" data-tour="try-trail">
            <TrailPanel
              state={state}
              agentName={agentName}
              writerName={persona?.patient.firstName}
              writerFullName={persona ? `${persona.patient.firstName} ${persona.patient.lastName}` : undefined}
              onWriteAnother={writeAnother}
              onRetry={() => submit()}
            />
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function TrailPanel({
  state,
  agentName,
  writerName,
  writerFullName,
  onWriteAnother,
  onRetry,
}: {
  state: RunState;
  agentName: string;
  /** The chosen sample patient's first name, for the empty state. */
  writerName?: string;
  /** The chosen sample patient's full name, for the initials avatar the picker also shows. */
  writerFullName?: string;
  onWriteAnother: () => void;
  onRetry: () => void;
}) {
  if (state.phase === "idle") return <IdleTrail writerName={writerName} writerFullName={writerFullName} />;

  if (state.phase === "failed") {
    return (
      <>
        <YourMessage state={state} />
        <Notice
          tone="error"
          title={FAILED_TITLE}
          className="mt-4"
          actions={
            <Button size="sm" variant="secondary" leadingIcon={RotateCcw} onClick={onRetry}>
              Run it again
            </Button>
          }
        >
          {FAILED_BODY}
        </Notice>
      </>
    );
  }

  const { input } = state;
  const first = input.patient.firstName;

  if (state.phase === "running") {
    const partial = partialResult("MSG-TRY", state.steps.filter((s) => s.id !== "decide"));
    return (
      <>
        <YourMessage state={state} />
        {state.fallback ? (
          <FallbackNotice fallback={state.fallback} engine={state.engine} className="mt-4" />
        ) : (
          <EngineLine text="Running the checks on the server" busy />
        )}
        <Trail result={partial} running title="Live trail" className="mt-2" />
      </>
    );
  }

  const result = state.result;
  const example = exampleForText(input.patient.id, input.text);
  const idiom = idiomNote(result);
  const openByDefault: StepId[] =
    result.route === "draft" ? ["draft"] : result.route === "clinician" || result.route === "urgent" ? ["rules"] : [];

  return (
    <>
      <YourMessage state={state} />
      {state.fallback ? (
        <FallbackNotice fallback={state.fallback} engine={state.engine} result={result} className="mt-4" />
      ) : (
        <EngineLine text={engineText(result)} />
      )}
      {idiom && <InfoNote className="mt-3">{idiom}</InfoNote>}
      <Trail
        key={state.runId}
        result={result}
        title="Live trail"
        className="mt-2"
        messageText={input.text}
        subject={false}
        names={{ firstName: first, agentName }}
        defaultOpen={openByDefault}
        actions={<DecideActions result={result} onWriteAnother={onWriteAnother} />}
      />
      {example?.note && (!example.noteWhen || example.noteWhen.includes(result.route)) && (
        <InfoNote className="mt-4">{example.note}</InfoNote>
      )}
    </>
  );
}

/** One quiet explanatory line, the same look wherever the Try page explains an outcome. */
function InfoNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-inner bg-field p-3 text-sm text-ink", className)}>
      <Info aria-hidden size={16} className="mt-0.5 shrink-0 text-navy-900" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Where the visitor's words go, as one sentence under the message box. It follows the last run: a run that fell back
 * to the browser, or a server run the live AI did not answer, says so instead of promising a trip to the AI.
 */
function privacyLine(state: RunState): string {
  if (state.phase === "running" || state.phase === "done") {
    if (state.engine === "browser")
      return "Use made-up details only: the live AI did not answer, so this run finished in your browser, and nothing is stored.";
    if (state.fallback) return "Use made-up details only: this run was checked on our server without the live AI, and nothing is stored.";
  }
  return "Use made-up details only: we remove the personal details we can spot before the AI sees your message, and store nothing.";
}

/** Where a server run happened. Says "live AI" only when a real model actually ran. */
function engineText(result: PipelineResult): string {
  const total = result.trail.reduce((n, s) => n + (s.ms ?? 0), 0);
  const secs = total >= 100 ? ` in ${(total / 1000).toFixed(1)} s` : "";
  if (!usedAnyModel(result)) {
    return isStoppedByRules(result)
      ? `Ran on the server${secs}. The safety rules stopped it before any AI saw it.`
      : `Ran on the server with the rules only${secs}. No AI saw it.`;
  }
  if (usedSampleModels(result)) return `Ran on the server with a simple built-in stand-in for Claude${secs}. The safety rules and fact check are real.`;
  return `Ran on the live AI${secs}`;
}

/** One quiet line above the trail saying where it ran. Same place while running and after, so nothing jumps. */
function EngineLine({ text, busy = false }: { text: string; busy?: boolean }) {
  return (
    <p className="mt-5 flex items-start gap-2 text-xs font-medium text-muted" aria-hidden>
      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-pill", busy ? "bg-focus motion-safe:animate-pulse" : "bg-success-icon")} />
      <span>{text}</span>
    </p>
  );
}

function DecideActions({ result, onWriteAnother }: { result: PipelineResult; onWriteAnother: () => void }) {
  const safety = result.route === "clinician" || result.route === "urgent";
  const lead =
    result.route === "draft"
      ? "On the desk, an agent reviews this draft and sends it. Nothing is sent from here."
      : safety
        ? "On the desk, this goes to the clinician queue with the reason highlighted. Nothing is sent from here."
        : "On the desk, an agent writes this reply. Nothing is sent from here.";
  return (
    <>
      <p className="basis-full text-sm text-ink">{lead}</p>
      <Button size="sm" variant="secondary" onClick={onWriteAnother}>
        Try another message
      </Button>
      {safety ? (
        <Button size="sm" variant="ghost" href="/clinician/" leadingIcon={Stethoscope}>
          See the clinician queue
        </Button>
      ) : (
        <Button size="sm" variant="ghost" href="/desk/" trailingIcon={ArrowRight}>
          See the desk
        </Button>
      )}
    </>
  );
}

function YourMessage({ state }: { state: Exclude<RunState, { phase: "idle" }> }) {
  const p = state.input.patient;
  return (
    <figure className="rounded-inner bg-inset p-3">
      <figcaption className="flex items-center gap-2 text-xs text-muted">
        <Avatar name={`${p.firstName} ${p.lastName}`} size="sm" />
        <span>
          <span className="font-semibold text-heading">{shortName(p)}</span> wrote, as a chat message
        </span>
      </figcaption>
      <blockquote className="mt-2 line-clamp-4 whitespace-pre-line break-words text-sm text-ink">{state.input.text}</blockquote>
    </figure>
  );
}

/**
 * The one message shown when the live AI did not answer: why, and what the visitor is looking at instead. It takes
 * the engine line's place, so the same thing is never said three ways.
 */
function FallbackNotice({
  fallback,
  engine,
  result,
  className,
}: {
  fallback: Fallback;
  engine: "live" | "browser";
  result?: PipelineResult;
  className?: string;
}) {
  const { title, reason, what } = fallbackCopy(fallback, engine, result);
  return (
    <Notice tone="info" title={title} className={className}>
      {reason} {what}
    </Notice>
  );
}

/**
 * Before the first run: who is writing (the same initials avatar the picker uses), what to do, and the seven checks
 * waiting quietly. The steps sit where the live trail will draw them, so nothing jumps when the run starts.
 */
function IdleTrail({ writerName, writerFullName }: { writerName?: string; writerFullName?: string }) {
  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          {writerFullName ? (
            <Avatar name={writerFullName} size="lg" className="size-14! text-lg! sm:size-16!" />
          ) : (
            <span
              aria-hidden
              className="inline-flex size-14 items-center justify-center rounded-pill bg-navy-100 text-navy-900 sm:size-16"
            >
              <MessageCircle size={22} strokeWidth={2} />
            </span>
          )}
          {writerFullName && (
            <span
              aria-hidden
              className="absolute -bottom-1 -right-1 inline-flex size-6 items-center justify-center rounded-pill bg-navy-900 text-white ring-2 ring-surface"
            >
              <MessageCircle size={12} strokeWidth={2.5} />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-heading">Live trail</h2>
          <p className="mt-0.5 text-sm text-muted">
            {writerName ? `Write as ${writerName} and press ` : "Write a message and press "}
            <span className="whitespace-nowrap font-medium text-heading">Run the checks</span>.
          </p>
        </div>
      </div>
      <ol className="mt-6 flex flex-col" aria-label="The seven checks">
        {STEPS.map((id, i) => (
          <li key={id} className={cn("relative flex items-center gap-3", i < STEPS.length - 1 && "pb-3.5")}>
            {i < STEPS.length - 1 && (
              <span aria-hidden className="absolute bottom-0 left-[13px] top-7 border-l-2 border-line-cool" />
            )}
            <StatusIcon state="pending" stopTone="clinician" />
            <span className="text-sm text-muted">{STEP_LABEL[id]}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-balance text-xs text-muted">A safety word stops the trail before any reply is written.</p>
    </div>
  );
}
