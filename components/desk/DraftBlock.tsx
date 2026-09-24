"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, CircleCheck, CircleX, LoaderCircle, MessageSquareQuote, PenLine, TriangleAlert } from "lucide-react";
import type { CheckResult, Draft, FactCheck, SourceRef } from "@/lib/types";
import { FACT_KIND_LABEL, fillDraftPlaceholders } from "@/lib/format";
import { withCitations, withDraftPlaceholders } from "@/components/trail/text";
import {
  RecentMessages,
  CHECK_FIRST_SPOKEN,
  CHECK_FIRST_WORDS,
  SourceItem,
  checkFirstCount,
  checkFirstFacts,
  checkFirstNote,
  factState,
  passedHeadline,
  shownSourceId,
  workedOutText,
} from "@/components/trail";
import { prefersReducedMotion } from "@/components/trail/reveal";
import { Button, cn } from "@/components/ui";
import { banHelp } from "./desk-model";

/**
 * The draft as the agent reviews it: names filled, citation markers that light up their source on hover and focus,
 * and one folded line under it for the sources (and the patient's other recent messages the draft read).
 */
export function DraftView({
  draft,
  sources,
  firstName,
  agentName,
  heading,
  badge,
  recent,
  muted = false,
}: {
  draft: Draft;
  sources: SourceRef[];
  firstName: string;
  agentName: string;
  /** A header row over the text (the held draft names itself); the reply card's own title usually does this. */
  heading?: ReactNode;
  badge?: ReactNode;
  /** The patient's other recent messages the draft read as context: named in the sources fold, linked, never cited. */
  recent?: readonly string[];
  /** Shown for reference only (Send is off): quieter text. */
  muted?: boolean;
}) {
  const base = useId();
  const [active, setActive] = useState<string | null>(null);
  // The cited sources are listed again in the trail's Sources step, so here they fold into one line until asked for.
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const listOpen = sourcesOpen;
  const listId = `${base}-sources`;
  const byMarker = new Map(draft.citations.map((c) => [c.marker, c.sourceId]));
  const bySource = new Map(sources.map((s) => [s.id, s]));
  const text = fillDraftPlaceholders(draft.text, firstName, agentName);

  // Cited sources in the order of their first marker, each with its numbers.
  const cited: { source: SourceRef; numbers: string[] }[] = [];
  for (const c of draft.citations) {
    const s = bySource.get(c.sourceId);
    if (!s) continue;
    const n = c.marker.slice(1, -1);
    const found = cited.find((x) => x.source.id === s.id);
    if (found) found.numbers.push(n);
    else cited.push({ source: s, numbers: [n] });
  }
  const recentCount = recent?.length ?? 0;
  const anchor = (sid: string) => `${base}-src-${sid.replace(/[^A-Za-z0-9_-]/g, "_")}`;

  return (
    <div className="flex flex-col">
      {heading && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-cool px-4 py-2.5">
          <p className="text-xs font-semibold text-heading">{heading}</p>
          {badge}
        </div>
      )}
      <p data-tour="desk-draft-text" className={cn("whitespace-pre-wrap break-words px-4 py-3.5 text-sm leading-relaxed", muted ? "text-muted" : "text-ink")}>
        {withCitations(
          text,
          (marker, key) => {
            const sid = byMarker.get(marker);
            const n = marker.slice(1, -1);
            const src = sid ? bySource.get(sid) : undefined;
            if (!sid || !src) return <sup key={key}>{n}</sup>;
            const on = active === sid;
            return (
              <button
                key={key}
                type="button"
                aria-label={`Source ${n}: ${src.label}`}
                aria-describedby={anchor(sid)}
                onPointerEnter={() => setActive(sid)}
                onPointerLeave={() => setActive((a) => (a === sid ? null : a))}
                onFocus={() => setActive(sid)}
                onBlur={() => setActive((a) => (a === sid ? null : a))}
                onClick={() => {
                  setActive(sid);
                  const wasOpen = listOpen;
                  setSourcesOpen(true);
                  // Wait for the list to open before scrolling to the source.
                  window.setTimeout(
                    () =>
                      document
                        .getElementById(anchor(sid))
                        ?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" }),
                    wasOpen ? 0 : 240,
                  );
                }}
                className={cn(
                  "mx-0.5 inline-flex h-4.5 min-w-4.5 -translate-y-0.5 items-center justify-center rounded-md px-1 align-middle text-2xs font-semibold tnum",
                  "transition-colors duration-150",
                  on ? "bg-info-fg text-white" : "bg-info-bg text-info-fg hover:bg-info-fg hover:text-white",
                )}
              >
                {n}
              </button>
            );
          },
          (part, key) => <span key={key}>{withDraftPlaceholders(part, key)}</span>,
        )}
      </p>
      {cited.length === 0 && recentCount > 0 && (
        <div className="border-t border-line-cool px-4 py-2.5">
          <RecentMessages ids={recent} />
        </div>
      )}
      {cited.length > 0 && (
        <div data-tour="desk-citations" className="border-t border-line-cool px-4 py-1.5">
          <button
            type="button"
            aria-expanded={listOpen}
            aria-controls={listId}
            onClick={() => setSourcesOpen(!listOpen)}
            className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-inner px-2 py-1.5 text-left text-xs font-medium text-heading transition-colors duration-150 hover:bg-navy-900/[0.04] active:bg-navy-900/[0.07]"
          >
            <span>
              Facts come from {cited.length} {cited.length === 1 ? "source" : "sources"}
              {recentCount > 0 && (
                <span className="font-normal text-muted">
                  {" "}
                  and {recentCount} recent {recentCount === 1 ? "message" : "messages"}
                </span>
              )}
            </span>
            <ChevronDown
              aria-hidden
              size={15}
              className={cn("shrink-0 text-muted-icon transition-transform duration-200 ease-out-expo", listOpen && "rotate-180")}
            />
          </button>
          <div id={listId} className="collapsible" data-open={listOpen} inert={!listOpen}>
            <div>
              <ul className="divide-y divide-line-cool pb-1.5">
                {cited.map(({ source, numbers }) => (
                  <SourceItem
                    key={source.id}
                    source={source}
                    anchorId={anchor(source.id)}
                    cited={numbers}
                    highlighted={active === source.id}
                  />
                ))}
              </ul>
              {recentCount > 0 && <RecentMessages ids={recent} className="border-t border-line-cool py-2.5" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Which facts in the text are not in the sources, and any phrases never allowed in a reply. */
export function checkProblems(check: CheckResult | null) {
  const missing = check?.facts.filter((f) => !f.found) ?? [];
  const banned = check?.banned ?? [];
  return { missing, banned };
}

/**
 * One checked fact as a small tag: mint for a fact found in the sources (with "Worked out from ..." when the checker
 * worked it out from two cited amounts), butter for the patient's own words, which a person checks first. `onTint`
 * draws it white, for use inside a tinted box.
 */
function FactChip({ fact, onTint = false }: { fact: FactCheck; onTint?: boolean }) {
  const kind = FACT_KIND_LABEL[fact.kind].toLowerCase();
  const box = "inline-flex min-h-6 max-w-full flex-wrap items-center gap-x-1 rounded-inner px-2.5 py-0.5 text-xs font-medium tnum";
  if (factState(fact) === "check_first") {
    return (
      <li className={cn(box, onTint ? "bg-surface text-warning-fg" : "bg-warning-bg text-warning-fg")}>
        <MessageSquareQuote aria-hidden size={12} className="shrink-0" />
        <span className="font-semibold">{fact.text}</span>
        <span aria-hidden className="font-normal">
          {CHECK_FIRST_WORDS}
        </span>
        <span className="sr-only">
          , {kind}
          {CHECK_FIRST_SPOKEN}
        </span>
      </li>
    );
  }
  const worked = workedOutText(fact);
  return (
    <li className={cn(box, "bg-success-bg text-success-fg")}>
      <CircleCheck aria-hidden size={12} className="shrink-0" />
      {fact.text}
      {worked && (
        <span aria-hidden className="font-normal">
          {worked}
        </span>
      )}
      <span className="sr-only">
        , {kind}
        {fact.derivedFrom ? `, worked out from ${fact.derivedFrom}` : ""}, found in {shownSourceId(fact)}
      </span>
    </li>
  );
}

/**
 * The note above Send when a detail in the reply comes only from the patient's own message:
 * "1 detail comes from the patient's own message. Check it before sending." Not a block: Send stays on.
 * `showFacts` names the details, for the draft view, where the fact check itself is folded away.
 */
export function CheckFirstNote({ check, showFacts = false }: { check: CheckResult | null | undefined; showFacts?: boolean }) {
  const note = checkFirstNote(checkFirstCount(check));
  if (!note) return null;
  const facts = showFacts ? checkFirstFacts(check) : [];
  return (
    <div data-desk-check-first="" className="flex items-start gap-2 rounded-inner bg-warning-bg px-3 py-2 text-xs">
      <MessageSquareQuote aria-hidden size={15} className="mt-px shrink-0 text-warning-fg" />
      <p className="min-w-0 font-semibold text-warning-fg">
        {note}
        {facts.map((f, i) => (
          <span key={f.text + i} className="ml-1.5 inline-flex items-center rounded-pill bg-surface px-2 font-semibold text-heading tnum">
            {f.text}
          </span>
        ))}
      </p>
    </div>
  );
}

/** The live fact check under the editor. Re-runs a moment after each change. */
export function LiveCheck({
  check,
  pending,
  strict,
  acknowledged,
  onAcknowledge,
  onRewrite,
}: {
  check: CheckResult | null;
  pending: boolean;
  /** Unsupported facts block Send (an edit of an AI draft). Otherwise the agent can confirm them. */
  strict: boolean;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  /** Select the blocked words in the editor so the agent can rewrite them. Offered for a non-clinical policy block. */
  onRewrite?: () => void;
}) {
  const ackId = useId();
  // What to do about blocked words, in plain words: a clinical block points to a clinician (a played-down symptom, a
  // dosing or product claim); a policy block (a card number, a password, a placeholder left in) is rewritten here.
  const help = banHelp(check);
  if (pending || !check) {
    return (
      <p role="status" className="flex items-center gap-2 text-xs font-medium text-muted">
        <LoaderCircle aria-hidden size={14} className="animate-spin" />
        Checking the facts in your reply
      </p>
    );
  }
  const { missing, banned } = checkProblems(check);
  const found = check.facts.filter((f) => f.found);
  const ownWords = checkFirstFacts(check);

  if (!missing.length && !banned.length) {
    return (
      <div role="status" className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-success-fg">
          <CircleCheck aria-hidden size={14} />
          {passedHeadline(check)}
        </p>
        {found.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={ownWords.length ? "Facts checked" : "Facts found in the sources"}>
            {found.map((f, i) => (
              <FactChip key={f.text + i} fact={f} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div role="status" className={cn("rounded-inner p-3", banned.length || strict ? "bg-error-bg" : "bg-warning-bg")}>
      {missing.length > 0 && (
        <>
          <p className={cn("flex items-center gap-1.5 text-xs font-semibold", strict ? "text-error-fg" : "text-warning-fg")}>
            {strict ? <CircleX aria-hidden size={14} /> : <TriangleAlert aria-hidden size={14} />}
            {missing.length === 1 ? "1 fact is not in the sources" : `${missing.length} facts are not in the sources`}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {missing.map((f, i) => (
              <li
                key={f.text + i}
                className="inline-flex h-6 items-center gap-1 rounded-pill bg-surface px-2.5 text-xs font-semibold text-heading tnum"
              >
                {f.text}
                <span className="font-normal text-muted">{FACT_KIND_LABEL[f.kind].toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {ownWords.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="From the patient's own message">
          {ownWords.map((f, i) => (
            <FactChip key={f.text + i} fact={f} onTint />
          ))}
        </ul>
      )}
      {banned.length > 0 && (
        <p className={cn("flex items-start gap-1.5 text-xs font-semibold text-error-fg", missing.length > 0 && "mt-2.5")}>
          <CircleX aria-hidden size={14} className="mt-0.5 shrink-0" />
          Never allowed in a reply: {banned.join(", ")}
        </p>
      )}
      <p className="mt-2 text-xs text-ink">
        {help
          ? help.line
          : strict
            ? "Fix or remove it to send. The patient's record and the policy are the only sources a reply may use."
            : "You wrote this reply yourself. Check it against the patient's record, then confirm to send."}
      </p>
      {help?.kind === "policy" && onRewrite && (
        <Button size="sm" variant="secondary" leadingIcon={PenLine} onClick={onRewrite} className="mt-2">
          Rewrite that part
        </Button>
      )}
      {!strict && !banned.length && missing.length > 0 && (
        <label htmlFor={ackId} className="mt-2 flex cursor-pointer items-start gap-2 text-xs font-medium text-heading">
          <input
            id={ackId}
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-navy-900"
          />
          I have checked {missing.length === 1 ? "this" : "these"} against the record myself
        </label>
      )}
    </div>
  );
}
