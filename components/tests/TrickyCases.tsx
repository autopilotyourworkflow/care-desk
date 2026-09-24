"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import type { EvalCase } from "@/lib/types";
import type { PublicEvalReport } from "@/lib/client/types";
import { Button, Card, CardHeader, Chip, HoldBadge, Inset, RiskBadge } from "@/components/ui";
import { COUNTRY_LABEL, ROUTE_LABEL } from "@/lib/format";
import { caseOutcome, FILTER_LABEL } from "./model";
import { TRICKY_CASES } from "./tricky";

/** What the system did with a case, in one sentence, from the evaluated result. */
export function didText(c: EvalCase): string {
  const hold = c.got.holdOrders;
  switch (c.got.route) {
    case "urgent":
      return `Sent to a clinician as urgent${hold ? ", with the patient's orders on hold" : ""}. No AI reply.`;
    case "clinician":
      return `Sent to the clinician queue${hold ? ", with the patient's orders on hold" : ""}. No AI reply.`;
    case "person":
      return `Left for a person to write, with no AI draft${hold ? " and the patient's orders on hold" : ""}.`;
    case "draft":
      return "Wrote a checked draft for an agent to review and send.";
  }
}

export function expectedText(c: EvalCase): string {
  const e = c.expected;
  return `${ROUTE_LABEL[e.expectedRoute].toLowerCase()}${e.mustHold ? ", with orders on hold" : ", no hold"}`;
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
/** A count that opens a sentence: a word up to twelve, figures above. */
const countWord = (n: number) => WORDS[n] ?? String(n);

/** How many tricky cases show before "Show all". */
export const TRICKY_SHOWN = 3;

/** Six to eight hard cases in plain words: why each one is tricky, and what Care Desk actually did. Three show first. */
export function TrickyCases({ report, onOpen }: { report: PublicEvalReport; onOpen: (id: string) => void }) {
  const byId = new Map(report.cases.map((c) => [c.messageId, c]));
  const items = TRICKY_CASES.map((t) => ({ t, c: byId.get(t.id), meta: report.caseMeta[t.id] })).filter(
    (x): x is typeof x & { c: EvalCase } => !!x.c,
  );
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const trickyTotal = report.cases.filter((c) => c.expected.tricky).length;
  // The surprise messages are tricky ones too: say so, so the tricky and surprise counts visibly reconcile.
  const surpriseTricky = report.cases.filter((c) => c.expected.tricky && report.caseMeta[c.messageId]?.testOnly).length;
  const including = surpriseTricky > 0 ? `, including the ${surpriseTricky} surprise ones` : "";
  const shown = all ? items : items.slice(0, TRICKY_SHOWN);

  return (
    <Card as="section" aria-labelledby="tests-tricky-title" data-tour="tests-tricky">
      <CardHeader
        title={<span id="tests-tricky-title">Tricky cases</span>}
        description={
          trickyTotal > items.length
            ? `${countWord(items.length)} of the ${trickyTotal} tricky messages${including}, and what Care Desk did.`
            : `${countWord(items.length)} tricky messages written to catch it out, and what Care Desk did.`
        }
      />
      <ol id="tests-tricky-list" className="flex flex-col">
        {shown.map(({ t, c, meta }) => {
          const outcome = caseOutcome(c);
          return (
            <li
              key={t.id}
              className="grid gap-3 border-t border-line-cool py-5 first:border-t-0 first:pt-1 last:pb-0 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-8"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-heading">{t.title}</h3>
                  {meta?.testOnly && <Chip tone="outline">{FILTER_LABEL.redteam}</Chip>}
                </div>
                <Inset className="mt-2.5">
                  <blockquote>
                    <p className="text-base text-ink">&ldquo;{t.quote}&rdquo;</p>
                  </blockquote>
                  {meta && (
                    <p className="mt-1.5 text-xs text-muted">
                      {meta.firstName}, {COUNTRY_LABEL[meta.country]}, by {meta.channel === "email" ? "email" : "chat"}
                    </p>
                  )}
                </Inset>
                <p className="mt-2.5 max-w-[65ch] text-sm text-ink">{t.why}</p>
              </div>

              <div className="min-w-0 md:pt-0.5">
                <p className="text-sm font-semibold text-heading">What Care Desk did</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <RiskBadge route={c.got.route} />
                  {c.got.holdOrders && <HoldBadge />}
                  <Chip tone={outcome.tone}>
                    <span className="sr-only">Result: </span>
                    {outcome.label}
                  </Chip>
                </div>
                <p className="mt-2 text-sm text-ink">{didText(c)}</p>
                <p className="mt-1 text-xs text-muted">
                  The label expected: {expectedText(c)}.{outcome.kind !== "match" && ` ${outcome.meaning}`}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  trailingIcon={ArrowRight}
                  className="-ml-3 mt-1.5"
                  onClick={() => onOpen(t.id)}
                  aria-label={`Open the full case, ${t.id}, ${t.title}`}
                >
                  Open the full case
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {items.length > TRICKY_SHOWN && (
        <div className="mt-4 border-t border-line-cool pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            aria-expanded={all}
            aria-controls="tests-tricky-list"
            trailingIcon={all ? ChevronUp : ChevronDown}
            onClick={() => setAll((v) => !v)}
          >
            {all ? "Show fewer" : `Show all ${items.length} tricky cases`}
          </Button>
        </div>
      )}
    </Card>
  );
}
