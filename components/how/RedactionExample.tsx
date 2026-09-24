"use client";

import { useMemo, useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Button, Chip, Inset, LoadingStatus, Notice, SegmentedControl, Skeleton, SkeletonText } from "@/components/ui";
import { RedactedText } from "@/components/trail";
import { cn } from "@/components/ui/cn";
import { useCase } from "@/lib/client/data";
import type { RedactionType } from "@/lib/types";
import { COUNTRY_LABEL } from "@/lib/format";

/** One demo message per country. Redaction is deterministic code, so these never change with the AI. */
const EXAMPLES = [
  { id: "MSG-0022", country: "AU", label: "Australia" },
  { id: "MSG-0005", country: "NZ", label: "New Zealand" },
  { id: "MSG-0033", country: "UK", label: "United Kingdom" },
] as const;
type ExampleId = (typeof EXAMPLES)[number]["id"];

const TYPE_WORDS: Record<RedactionType, [string, string]> = {
  name: ["name", "names"],
  email: ["email address", "email addresses"],
  phone: ["phone number", "phone numbers"],
  address: ["address or postcode", "addresses or postcodes"],
  dob: ["date of birth", "dates of birth"],
  health_id: ["health number", "health numbers"],
  card: ["card number", "card numbers"],
  other: ["other detail", "other details"],
};

const PLACEHOLDER = /\[[A-Z][A-Z_ ]*\]/g;

interface Segment {
  text: string;
  removed: boolean;
}

/**
 * Lines the original up against the redacted text: the text between placeholders is identical in both, so what sits
 * in the gaps of the original is what was removed. Returns null if the two do not line up, and the page then shows
 * the original without marks rather than guessing.
 */
export function alignRedaction(original: string, redacted: string): Segment[] | null {
  const literals = redacted.split(PLACEHOLDER);
  const out: Segment[] = [];
  if (!original.startsWith(literals[0])) return null;
  if (literals[0]) out.push({ text: literals[0], removed: false });
  let pos = literals[0].length;
  for (let i = 1; i < literals.length; i++) {
    const lit = literals[i];
    const last = i === literals.length - 1;
    let at: number;
    if (last) {
      at = lit ? original.length - lit.length : original.length;
      if (lit && !original.endsWith(lit)) return null;
    } else {
      at = lit ? original.indexOf(lit, pos + 1) : pos + 1;
    }
    if (at <= pos || at < 0) return null;
    out.push({ text: original.slice(pos, at), removed: true });
    if (lit) out.push({ text: lit, removed: false });
    pos = at + lit.length;
  }
  return pos === original.length ? out : null;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const KEPT = new RegExp(
  [
    String.raw`\b(?:ORD|CHG|APT)-\d{5}\b`,
    String.raw`\bCD\d{10}\b`,
    String.raw`(?:A\$|NZ\$|\$|£)\d[\d,]*(?:\.\d{2})?`,
    String.raw`\b\d{1,2} (?:${MONTHS})(?: \d{4})?\b`,
  ].join("|"),
  "g",
);

/** The facts the reply still needs, found in what the AI sees: order and charge numbers, tracking, amounts, dates. */
export function keptFacts(redacted: string): string[] {
  return [...new Set(redacted.match(KEPT) ?? [])];
}

export function RedactionExample() {
  const [id, setId] = useState<ExampleId>(EXAMPLES[0].id);
  const res = useCase(id);
  const c = res.data?.messageId === id ? res.data : undefined;

  const segments = useMemo(() => (c ? alignRedaction(c.text, c.result.redactedText) : null), [c]);
  const kept = useMemo(() => (c ? keptFacts(c.result.redactedText) : []), [c]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SegmentedControl
          label="Example message from"
          hideLabel={false}
          value={id}
          onChange={setId}
          items={EXAMPLES.map((e) => ({ id: e.id, label: e.label }))}
          className="max-sm:w-full [&_[role=radiogroup]]:max-sm:flex [&_[role=radiogroup]]:max-sm:w-full [&_[role=radio]]:max-sm:flex-1 [&_[role=radio]]:max-sm:px-1.5 [&_[role=radio]]:max-sm:text-xs"
        />
        {c && (
          <p className="text-sm text-muted tnum">
            {c.messageId}, {c.message.channel === "email" ? "email" : "chat"} from {c.patient.firstName},{" "}
            {COUNTRY_LABEL[c.patient.country]}
          </p>
        )}
      </div>

      {res.status === "error" ? (
        <Notice
          tone="error"
          role="alert"
          title="This example could not load"
          className="mt-4"
          actions={
            <Button variant="secondary" size="sm" leadingIcon={RotateCcw} onClick={res.retry}>
              Try again
            </Button>
          }
        >
          {res.error?.message ?? "Check your connection and try again."}
        </Notice>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2" aria-busy={!c || undefined}>
          <Pane title="What the agent sees" note="The message as it arrived">
            {c ? (
              segments ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
                  {segments.map((s, i) =>
                    s.removed ? (
                      <span
                        key={i}
                        className="rounded-md bg-navy-50 px-0.5 font-medium text-navy-900 underline decoration-navy-300 decoration-2 underline-offset-[3px]"
                      >
                        {s.text}
                      </span>
                    ) : (
                      <span key={i}>{s.text}</span>
                    ),
                  )}
                </p>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{c.text}</p>
              )
            ) : (
              <PaneSkeleton />
            )}
          </Pane>
          <Pane title="What the AI sees" note="Placeholders, before any AI step" tone="ai">
            {c ? <RedactedText text={c.result.redactedText} /> : <PaneSkeleton />}
          </Pane>
        </div>
      )}

      {!c && res.status !== "error" && <LoadingStatus label="Loading the example message" />}

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-muted">Removed before the AI saw it</dt>
          <dd className="mt-2 flex min-h-6 flex-wrap gap-1.5">
            {c ? (
              c.result.redactions.map((r) => (
                <Chip key={r.type} tone="navy">
                  {r.count} {TYPE_WORDS[r.type][r.count === 1 ? 0 : 1]}
                </Chip>
              ))
            ) : (
              <>
                <Skeleton rounded="pill" className="h-6 w-20" />
                <Skeleton rounded="pill" className="h-6 w-28" />
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-muted">Kept, because the reply needs them</dt>
          <dd className="mt-2 flex min-h-6 flex-wrap gap-1.5">
            {c ? (
              kept.length ? (
                kept.map((k) => (
                  <Chip key={k} tone="success" className="tnum">
                    {k}
                  </Chip>
                ))
              ) : (
                <span className="text-sm text-muted">Nothing the reply depends on was in the text.</span>
              )
            ) : (
              <Skeleton rounded="pill" className="h-6 w-24" />
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line-cool pt-4">
        <p className="max-w-[60ch] text-sm text-muted">
          It removes too much on purpose: hiding a doctor&apos;s name costs nothing, leaking a patient&apos;s would.
        </p>
        <Button href={`/desk/?m=${id}`} variant="secondary" size="sm" trailingIcon={ArrowRight}>
          Open it on the desk
        </Button>
      </div>
    </div>
  );
}

function Pane({
  title,
  note,
  tone = "agent",
  children,
}: {
  title: string;
  note: string;
  tone?: "agent" | "ai";
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-semibold text-heading">{title}</h3>
        <p className="text-xs text-muted">{note}</p>
      </div>
      <Inset className={cn("min-h-40 p-4", tone === "ai" && "bg-field")}>{children}</Inset>
    </section>
  );
}

function PaneSkeleton() {
  return (
    <div className="space-y-4">
      <SkeletonText lines={1} className="w-1/2" />
      <SkeletonText lines={4} />
      <SkeletonText lines={2} />
    </div>
  );
}
