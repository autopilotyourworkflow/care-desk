"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  BookText,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  CircleX,
  ClipboardList,
  EyeOff,
  History,
  MessageSquareQuote,
  Package,
  Receipt,
  ScanEye,
} from "lucide-react";
import type { FactCheck, PipelineResult, RuleHit, SourceKind, SourceRef, ThreadEntry } from "@/lib/types";
import {
  FACT_KIND_LABEL,
  fillDraftPlaceholders,
  formatPercent,
  formatVersion,
  modelLabel,
  plural,
  REDACTION_LABEL,
  shortPhrase,
  RISK_LABEL,
  ROUTE_LABEL,
} from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { Chip } from "@/components/ui/Chip";
import { Disclosure } from "@/components/ui/Disclosure";
import { Tooltip } from "@/components/ui/Tooltip";
import type { IconType } from "@/components/ui/Button";
import { HitsInContext, isEarlierHit, RedactedText, withCitations, withDraftPlaceholders } from "./text";
import { SAFETY_ORDER } from "./outcome";
import { AGENT_DEATH_RULE_ID } from "@/lib/pipeline/death";
import { ruleTooltip } from "@/lib/rule-labels";
import {
  CHECK_FIRST_SPOKEN,
  CHECK_FIRST_WORDS,
  checkFirstCount,
  factsCaption,
  factState,
  recentMessagesLead,
  shownSourceId,
  splitLateNote,
  workedOutText,
} from "./facts";

export { stopReason } from "./outcome";

/*
 * Evidence renders inside ONE inset block per step (see StepRow). Items inside it are flat rows separated by thin
 * rules: no second background, no ring. The only white surface in here is the draft itself, the one artefact.
 */

const SOURCE_ICON: Record<SourceKind, IconType> = {
  order: Package,
  charge: Receipt,
  appointment: CalendarDays,
  plan: ClipboardList,
  policy: BookText,
};

/** Names used to fill the draft's [FIRST_NAME] and [AGENT_NAME] placeholders for display. */
export interface DraftNames {
  firstName?: string;
  agentName?: string;
}

function Label({ children, className, strong = false }: { children: ReactNode; className?: string; strong?: boolean }) {
  return (
    <p className={cn("mb-1.5 text-xs", strong ? "font-semibold text-heading" : "font-medium text-muted", className)}>
      {children}
    </p>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs text-muted tnum">{children}</p>;
}

export function RedactEvidence({
  result,
  aiThread,
}: {
  result: PipelineResult;
  /** The earlier messages as the AI was given them (already redacted). Shown with the message when given. */
  aiThread?: Pick<ThreadEntry, "from" | "body">[];
}) {
  const total = result.redactions.reduce((n, r) => n + r.count, 0);
  // Did any AI step (Claude or its built-in stand-in) read this message? Not when the safety rules stopped it first.
  const aiSaw = Boolean(result.models.sort || result.models.draft);
  const stoppedByRules = result.trail.some((s) => s.id === "rules" && s.status === "stopped");
  const earlier = aiSaw ? (aiThread ?? []).filter((e) => e.body.trim()) : [];
  return (
    <div>
      {total > 0 ? (
        <>
          <Label>{aiSaw ? "Hidden before the AI saw the message" : "Hidden before any AI step"}</Label>
          <ul className="flex flex-wrap gap-1.5">
            {result.redactions.map((r) => (
              <li
                key={r.type + r.placeholder}
                className="inline-flex h-7 items-center gap-2 rounded-pill bg-surface pl-1 pr-2.5 text-xs"
              >
                <span className="rounded-pill bg-navy-100 px-2 py-0.5 text-2xs font-semibold text-navy-900">
                  {r.placeholder}
                </span>
                <span className="text-ink">
                  {REDACTION_LABEL[r.type]}
                  <span className="text-muted tnum">{r.count > 1 ? `, ${r.count}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-ink">No personal details found in this message.</p>
      )}
      <Disclosure summary={aiSaw ? "See what the AI saw" : "See the text with details hidden"} icon={ScanEye} className="mt-3">
        {earlier.length > 0 && <p className="mb-1 text-xs font-medium text-muted">This message</p>}
        <div className="border-l-2 border-line-strong pl-3">
          <RedactedText text={result.redactedText} />
        </div>
        {earlier.length > 0 && (
          <>
            <p className="mb-1 mt-3 text-xs font-medium text-muted">Earlier in the conversation</p>
            <ol className="flex flex-col gap-2">
              {earlier.map((e, i) => (
                <li key={i} className="border-l-2 border-line-cool pl-3">
                  <span className="block text-2xs font-semibold text-muted">{e.from === "patient" ? "Patient" : "Support"}</span>
                  <RedactedText text={e.body} />
                </li>
              ))}
            </ol>
          </>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <EyeOff aria-hidden size={13} className="shrink-0" />
          {aiSaw
            ? "Names, contact details and health IDs from the patient record are replaced before any AI step."
            : stoppedByRules
              ? "The AI never saw this message: the safety rules stopped it first."
              : "No AI step ran for this message."}
        </p>
      </Disclosure>
    </div>
  );
}

/**
 * True for a hit read in an earlier reply from the team, not in anything the patient wrote: the condolence words the
 * pipeline finds when the team already treated the patient as having died (AGENT_DEATH_RULE_ID, MSG-0995).
 */
export function isTeamHit(hit: Pick<RuleHit, "ruleId">): boolean {
  return hit.ruleId === AGENT_DEATH_RULE_ID || hit.ruleId.startsWith("thread.agent.");
}

/**
 * The earlier message a thread hit came from, if the caller passed the thread: a reply from the team for a team hit,
 * otherwise one of the patient's own messages. A team hit is never looked up in (or shown as) the patient's words.
 */
export function earlierSource(hit: RuleHit, thread?: readonly Pick<ThreadEntry, "from" | "body">[]): string | undefined {
  const needle = hit.phrase.toLowerCase();
  const from = isTeamHit(hit) ? "agent" : "patient";
  return thread?.filter((e) => e.from === from).find((e) => e.body.toLowerCase().includes(needle))?.body;
}

/** The label over the matches: whose words they are. */
export function matchesLabel(hits: readonly RuleHit[]): string {
  const team = hits.filter(isTeamHit).length;
  const own = hits.length - team;
  const teamPart = `${plural(team, "match", "matches")} in an earlier reply by the team`;
  if (!own) return teamPart;
  const ownPart = `${plural(own, "match", "matches")} in the patient's own words`;
  return team ? `${ownPart}, ${teamPart}` : ownPart;
}

type MarkTone = "urgent" | "clinician" | "hold";

/** Marks follow the stop: red only on an urgent stop, lavender on a clinician stop, amber for a hold request. */
function markTone(result: PipelineResult): MarkTone {
  if (result.route === "urgent") return "urgent";
  if (result.route === "clinician") return "clinician";
  return "hold";
}

const HIT_ORDER: readonly (RuleHit["category"])[] = [...SAFETY_ORDER, "stop_sending"];

export function RulesEvidence({
  result,
  messageText,
  thread,
  subject,
}: {
  result: PipelineResult;
  messageText?: string;
  thread?: ThreadEntry[];
  /** The first line of messageText is an email subject. Defaults to a guess from the text's shape. */
  subject?: boolean;
}) {
  const { hits } = result.rules;
  if (!hits.length) {
    return (
      <div>
        <p className="text-sm text-ink">
          No safety words found, so the message could go to the AI to be sorted. The rules run before any AI, every time.
        </p>
        <Meta>Rules version {formatVersion(result.versions.rules)}</Meta>
      </div>
    );
  }

  // One line per category, listing its matched words once.
  const byCategory = HIT_ORDER.map((category) => {
    const own = hits.filter((h) => h.category === category);
    return {
      category,
      phrases: Array.from(new Set(own.map((h) => h.phrase))),
      rules: Array.from(new Set(own.map((h) => h.ruleId))),
    };
  }).filter((g) => g.phrases.length > 0);

  // The current message is shown once with every match marked; each earlier message is its own group.
  const current = hits.filter((h) => !isEarlierHit(h));
  const earlierGroups = new Map<string, { text?: string; team: boolean; hits: RuleHit[] }>();
  for (const h of hits.filter(isEarlierHit)) {
    const text = earlierSource(h, thread);
    const team = isTeamHit(h);
    const key = `${team ? "team" : "patient"}:${text ?? `phrase:${h.phrase}`}`;
    const g = earlierGroups.get(key) ?? { text, team, hits: [] };
    g.hits.push(h);
    earlierGroups.set(key, g);
  }

  return (
    <div data-tone={markTone(result)}>
      <Label>{matchesLabel(hits)}</Label>
      <ul className="flex flex-col gap-1.5">
        {byCategory.map((g) => (
          <li key={g.category} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Tooltip content={ruleTooltip(g.rules)}>
              <Chip category={g.category} />
            </Tooltip>
            <span className="min-w-0 text-sm text-ink">
              {g.phrases.map((p, i) => (
                <span key={p}>
                  {i > 0 && ", "}
                  <q className="font-medium">{shortPhrase(p)}</q>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>

      {current.length > 0 && (
        <div className="mt-3 border-l-2 border-line-strong pl-3">
          <HitsInContext text={messageText} hits={current} subject={subject} />
        </div>
      )}

      {Array.from(earlierGroups.entries()).map(([key, g]) => (
        <div key={key} className="mt-3">
          <p className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted">
            <History aria-hidden size={13} /> {g.team ? "From an earlier reply by the team" : "In an earlier message"}
          </p>
          <div className="border-l-2 border-line-strong pl-3">
            <HitsInContext text={g.text} hits={g.hits} earlier subject={false} />
          </div>
        </div>
      ))}

      <Meta>
        Rules version {formatVersion(result.versions.rules)}. Tuned to over-escalate: a false alarm costs a minute, a miss
        is not acceptable.
      </Meta>
    </div>
  );
}

export function SortEvidence({ result }: { result: PipelineResult }) {
  const s = result.sort;
  if (!s) return <p className="text-sm text-ink">Not sorted: the safety rules stopped this message first.</p>;
  const pct = Math.round(s.confidence * 100);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip category={s.category} size="md" />
        <span className="text-sm text-muted">
          Risk: <span className="font-medium text-ink">{RISK_LABEL[s.risk]}</span>
        </span>
        <span className="text-sm text-muted">
          Route: <span className="font-medium text-ink">{ROUTE_LABEL[s.route]}</span>
        </span>
      </div>
      <div className="mt-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium text-muted">Confidence</span>
          <span className="font-semibold text-heading tnum">{formatPercent(s.confidence)}</span>
        </div>
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-pill bg-field"
          role="meter"
          aria-label="Sorting confidence"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="h-full rounded-pill bg-navy-900" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {s.reasons.length > 0 && (
        <>
          <Label className="mt-3">Why</Label>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink marker:text-muted-icon">
            {s.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {result.models.sort && <Meta>Sorted by {modelLabel(result.models.sort)}</Meta>}
    </div>
  );
}

/** Policy text longer than this is clamped to three lines, with a "Show full section" toggle. */
const CLAMP_CHARS = 200;

/** The citation number chip, the same marker the draft uses. */
function CiteNumber({ n }: { n: string }) {
  return (
    <span className="inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-md bg-info-bg px-1 text-2xs font-semibold text-info-fg tnum">
      {n}
    </span>
  );
}

export function SourceItem({
  source,
  anchorId,
  highlighted,
  cited,
  quiet = false,
}: {
  source: SourceRef;
  anchorId?: string;
  highlighted?: boolean;
  /** The draft's citation numbers for this source ("1", "3"). Shows the number chip and "Used in the draft". */
  cited?: string[];
  /** A source that was looked up but not used: quieter text. */
  quiet?: boolean;
}) {
  const Icon = SOURCE_ICON[source.kind];
  const clampable = source.kind === "policy" && source.text.length > CLAMP_CHARS;
  const [expanded, setExpanded] = useState(false);
  // Opening a source from a citation expands its clamp (adjusted during render, not in an effect).
  const [wasHighlighted, setWasHighlighted] = useState(false);
  if (Boolean(highlighted) !== wasHighlighted) {
    setWasHighlighted(Boolean(highlighted));
    if (highlighted && clampable) setExpanded(true);
  }
  const textId = anchorId ? `${anchorId}-text` : undefined;
  const clamped = clampable && !expanded;
  // An order that is past its estimated delivery date carries that as its last clause: shown as its own line.
  const { text: body, late } = source.kind === "order" ? splitLateNote(source.text) : { text: source.text, late: undefined };

  return (
    <li
      id={anchorId}
      tabIndex={-1}
      className={cn(
        "py-2.5 transition-colors duration-200 ease-out-expo first:pt-1 last:pb-0",
        highlighted && "-mx-2 rounded-inner bg-info-bg/60 px-2 first:pt-2.5 last:pb-2.5",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {cited?.map((n) => <CiteNumber key={n} n={n} />)}
            <span className={cn("text-sm font-medium", quiet ? "text-ink" : "text-heading")}>{source.label}</span>
            {source.kind !== "policy" && source.kind !== "plan" && (
              <code className="whitespace-nowrap rounded-md bg-field px-1.5 py-0.5 font-mono text-2xs text-heading">
                {source.id}
              </code>
            )}
          </div>
          <p
            id={textId}
            className={cn(
              "mt-1 whitespace-pre-line text-sm leading-relaxed",
              quiet ? "text-muted" : "text-ink",
              clamped && "line-clamp-3",
            )}
          >
            {body}
          </p>
          {late && <p className={cn("mt-1 text-sm leading-relaxed", quiet ? "text-muted" : "text-ink")}>{late}</p>}
          {clampable && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={textId}
              onClick={() => setExpanded((e) => !e)}
              className="-mx-1.5 mt-1 inline-flex h-7 items-center gap-1 rounded-inner px-1.5 text-xs font-medium text-heading transition-colors duration-150 hover:bg-navy-900/[0.06] active:bg-navy-900/10"
            >
              {expanded ? "Show less" : "Show full section"}
              <ChevronDown
                aria-hidden
                size={14}
                className={cn("transition-transform duration-200 ease-out-expo", expanded && "rotate-180")}
              />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function SourcesEvidence({
  result,
  anchor,
  highlighted,
}: {
  result: PipelineResult;
  anchor: (sourceId: string) => string;
  highlighted?: string | null;
}) {
  const src = result.sources;
  if (!src) return <p className="text-sm text-ink">No sources were looked up for this message.</p>;

  // Which sources the draft actually relied on, with their citation numbers.
  const numbers = new Map<string, string[]>();
  for (const c of result.draft?.text ? result.draft.citations : []) {
    const list = numbers.get(c.sourceId) ?? [];
    list.push(c.marker.slice(1, -1));
    numbers.set(c.sourceId, list);
  }
  const all = [...src.records, ...src.policy];
  const firstNumber = (s: SourceRef) => Number(numbers.get(s.id)?.[0] ?? Infinity);
  const cited = all.filter((s) => numbers.has(s.id)).sort((a, b) => firstNumber(a) - firstNumber(b));
  const item = (s: SourceRef, quiet = false) => (
    <SourceItem
      key={s.id}
      source={s}
      anchorId={anchor(s.id)}
      highlighted={highlighted === s.id}
      cited={numbers.get(s.id)}
      quiet={quiet}
    />
  );

  if (cited.length > 0) {
    const others = all.filter((s) => !numbers.has(s.id));
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Label strong>Used in the draft</Label>
          <ul className="divide-y divide-line-cool">{cited.map((s) => item(s))}</ul>
        </div>
        {others.length > 0 && (
          <div>
            <Label>Also looked up</Label>
            <ul className="divide-y divide-line-cool">{others.map((s) => item(s, true))}</ul>
          </div>
        )}
        <p className="text-xs text-muted">The drafter is given these facts and nothing else.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>From the patient&apos;s records</Label>
        {src.records.length ? (
          <ul className="divide-y divide-line-cool">{src.records.map((s) => item(s))}</ul>
        ) : (
          <p className="text-sm text-muted">No matching records.</p>
        )}
      </div>
      <div>
        <Label>From the support policy</Label>
        {src.policy.length ? (
          <ul className="divide-y divide-line-cool">{src.policy.map((s) => item(s))}</ul>
        ) : (
          <p className="text-sm text-muted">No matching policy sections.</p>
        )}
      </div>
      <p className="text-xs text-muted">
        {result.draft?.text
          ? "The drafter is given these facts and nothing else."
          : result.route === "clinician" || result.route === "urgent"
            ? "Context for the clinician. No AI reply was drafted."
            : "Context for the person who replies."}
      </p>
    </div>
  );
}

/**
 * "The draft also read this patient's other recent message: MSG-0115", each id a link to that message on the desk.
 * Context the drafter was shown, never a source: nothing in the draft may be cited from it.
 */
export function RecentMessages({ ids, className }: { ids?: readonly string[]; className?: string }) {
  const lead = recentMessagesLead(ids);
  if (!lead || !ids) return null;
  return (
    <p className={cn("text-xs text-muted", className)}>
      {lead}{" "}
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && ", "}
          <Link
            href={`/desk/?m=${id}`}
            scroll={false}
            className="font-medium text-heading underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:decoration-navy-900 tnum"
          >
            {id}
          </Link>
        </Fragment>
      ))}
    </p>
  );
}

function sourceLabel(result: PipelineResult, id: string): string {
  const all = [...(result.sources?.records ?? []), ...(result.sources?.policy ?? [])];
  return all.find((s) => s.id === id)?.label ?? id;
}

export function DraftEvidence({
  result,
  onCite,
  names,
}: {
  result: PipelineResult;
  onCite: (sourceId: string) => void;
  /** Fills "Hi [FIRST_NAME]," and "[AGENT_NAME]" for display. Unfilled ones show as fill-in tokens. */
  names?: DraftNames;
}) {
  const d = result.draft;
  if (!d) return <p className="text-sm text-ink">No draft was written for this message.</p>;
  if (d.declined) {
    return (
      <div>
        <p className="text-sm font-medium text-heading">The drafter declined to write a reply</p>
        <p className="mt-1 text-sm text-ink">{d.declined}</p>
      </div>
    );
  }
  const byMarker = new Map(d.citations.map((c) => [c.marker, c.sourceId]));
  // Display only: the fact check ran on the unfilled text.
  const text = fillDraftPlaceholders(d.text, names?.firstName, names?.agentName);
  return (
    <div>
      <div className="rounded-inner bg-surface p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {withCitations(
            text,
            (marker, key) => {
              const sid = byMarker.get(marker);
              const n = marker.slice(1, -1);
              if (!sid) return <sup key={key}>{n}</sup>;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onCite(sid)}
                  aria-label={`Source ${n}: ${sourceLabel(result, sid)}`}
                  className="mx-0.5 inline-flex h-4.5 min-w-4.5 -translate-y-0.5 items-center justify-center rounded-md bg-info-bg px-1 align-middle text-2xs font-semibold text-info-fg transition-colors duration-150 hover:bg-info-fg hover:text-white"
                >
                  {n}
                </button>
              );
            },
            (part, key) => <span key={key}>{withDraftPlaceholders(part, key)}</span>,
          )}
        </p>
      </div>
      {d.citations.length > 0 && (
        <>
          <Label className="mt-3">Cited sources</Label>
          <ul className="flex flex-col gap-1">
            {d.citations.map((c) => (
              <li key={c.marker} className="flex items-baseline gap-2 text-sm">
                <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-md bg-info-bg px-1 text-2xs font-semibold text-info-fg">
                  {c.marker.slice(1, -1)}
                </span>
                <button
                  type="button"
                  onClick={() => onCite(c.sourceId)}
                  className="text-left text-ink underline decoration-line-strong underline-offset-2 hover:decoration-navy-900"
                >
                  {sourceLabel(result, c.sourceId)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <RecentMessages ids={result.recentMessageIds} className="mt-3" />
      {result.models.draft && (
        <Meta>Drafted by {modelLabel(result.models.draft)}. No medical advice, only the facts it was given.</Meta>
      )}
    </div>
  );
}

/**
 * Found in the sources (mint), the patient's own words (butter, check first: not a pass like a found fact, not a
 * failure like a missing one), or not in the sources (blush). Icon plus words plus tint, never colour alone.
 */
function FactStatus({ fact }: { fact: FactCheck }) {
  const state = factState(fact);
  if (state === "found") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-success-fg">
        <CircleCheck aria-hidden size={15} className="shrink-0" /> Found
      </span>
    );
  }
  if (state === "check_first") {
    return (
      <span className="inline-flex items-start gap-1 font-medium text-warning-fg">
        <MessageSquareQuote aria-hidden size={15} className="mt-0.5 shrink-0" />
        <span aria-hidden>{CHECK_FIRST_WORDS}</span>
        <span className="sr-only">{CHECK_FIRST_SPOKEN}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-medium text-error-fg">
      <CircleX aria-hidden size={15} className="shrink-0" /> Not in the sources
    </span>
  );
}

/** The fact check's row tint: blush for a fact not in the sources, butter for the patient's own words. */
const FACT_ROW_TINT: Record<ReturnType<typeof factState>, string | false> = {
  found: false,
  check_first: "bg-warning-bg",
  missing: "bg-error-bg",
};

function SourceCode({ id }: { id?: string }) {
  return id ? (
    <code className="whitespace-nowrap font-mono text-xs text-heading">{id}</code>
  ) : (
    <span className="text-xs text-muted">None</span>
  );
}

export function CheckEvidence({ result }: { result: PipelineResult }) {
  const c = result.check;
  if (!c) return <p className="text-sm text-ink">Nothing to check: no draft was written.</p>;
  const caption = factsCaption(c);
  const ownWords = checkFirstCount(c) > 0;
  return (
    <div className="@container">
      {c.facts.length === 0 ? (
        <p className="text-sm text-ink">No dates, amounts, order numbers or time frames in this draft.</p>
      ) : (
        <>
          {/* Narrow containers (phones, side columns): a stacked list */}
          <ul className="divide-y divide-line-cool @sm:hidden" aria-label={caption}>
            {c.facts.map((f, i) => {
              const state = factState(f);
              const tint = FACT_ROW_TINT[state];
              const worked = workedOutText(f);
              const sourceId = shownSourceId(f);
              return (
                <li
                  key={f.text + i}
                  className={cn("py-2.5 first:pt-1 last:pb-0", tint && `-mx-2 rounded-inner px-2 first:pt-2.5 last:pb-2.5 ${tint}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-medium text-heading tnum">{f.text}</span>
                      <span className="block text-xs text-muted">{FACT_KIND_LABEL[f.kind]}</span>
                    </div>
                    {/* The patient's own words take a full line under the fact: the words are longer than a status. */}
                    {state !== "check_first" && (
                      <span className="shrink-0 text-sm">
                        <FactStatus fact={f} />
                      </span>
                    )}
                  </div>
                  {state === "check_first" && (
                    <p className="mt-1 text-sm">
                      <FactStatus fact={f} />
                    </p>
                  )}
                  {worked && <p className="mt-0.5 text-xs text-ink tnum">{worked}</p>}
                  {sourceId && (
                    <p className="mt-0.5 text-xs text-muted">
                      Source <SourceCode id={sourceId} />
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {/* Wider containers: a table */}
          <table className="hidden w-full border-collapse text-left text-sm @sm:table">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-line-cool text-xs text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Fact in the draft
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Result
                </th>
                <th scope="col" className="py-2 pl-3 font-medium">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {c.facts.map((f, i) => {
                const tint = FACT_ROW_TINT[factState(f)];
                const worked = workedOutText(f);
                return (
                  <tr key={f.text + i} className={cn("border-b border-line-cool last:border-0", tint)}>
                    <td className={cn("py-2 pr-3 align-top", tint && "pl-2")}>
                      <span className="font-medium text-heading tnum">{f.text}</span>
                      <span className="block text-xs text-muted">{FACT_KIND_LABEL[f.kind]}</span>
                      {worked && <span className="mt-0.5 block text-xs text-ink tnum">{worked}</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <FactStatus fact={f} />
                    </td>
                    <td className="py-2 pl-3 align-top">
                      <SourceCode id={shownSourceId(f)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {c.banned.length > 0 && (
        <div className="mt-3">
          <Label>Not allowed in a reply</Label>
          <ul className="flex flex-col gap-1">
            {c.banned.map((b) => (
              <li key={b} className="flex items-center gap-1.5 text-sm font-medium text-error-fg">
                <CircleX aria-hidden size={15} className="shrink-0" /> {b}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Meta>
        Every date, amount, order number, tracking number and time frame must appear in the sources
        {ownWords ? ", except a date or time the patient wrote themselves, which is marked check first" : ""}. No dosing
        figures, no product promotion.
      </Meta>
    </div>
  );
}
