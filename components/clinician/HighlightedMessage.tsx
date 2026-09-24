import type { ReactNode } from "react";
import type { PatientMessage, RuleHit } from "@/lib/types";
import { hitRanges, type Range } from "./model";

function withMarks(text: string, from: number, to: number, ranges: Range[]): ReactNode[] {
  const out: ReactNode[] = [];
  let pos = from;
  for (const r of ranges) {
    const s = Math.max(r.start, from);
    const e = Math.min(r.end, to);
    if (e <= s) continue;
    if (s > pos) out.push(<span key={`t${pos}`}>{text.slice(pos, s)}</span>);
    out.push(<mark key={`m${s}`}>{text.slice(s, e)}</mark>);
    pos = e;
  }
  if (to > pos) out.push(<span key={`t${pos}`}>{text.slice(pos, to)}</span>);
  return out;
}

/**
 * The whole message with the words that stopped it highlighted. `text` is messageText(message) (subject, a blank
 * line, then the body for email), which the rule-hit indexes point into. Hits from earlier messages are not marked.
 */
export function HighlightedMessage({
  message,
  text,
  hits,
}: {
  message: PatientMessage;
  text: string;
  hits: RuleHit[];
}) {
  const ranges = hitRanges(text, hits);
  const subject = message.subject;
  const hasSubject = !!subject && text.startsWith(subject);
  const bodyFrom = hasSubject ? Math.min(text.length, subject.length + 2) : 0;
  return (
    <div className="text-sm leading-relaxed text-ink">
      {hasSubject && (
        <p className="mb-2 font-semibold text-heading">
          <span className="sr-only">Subject: </span>
          {withMarks(text, 0, subject.length, ranges)}
        </p>
      )}
      <p className="whitespace-pre-wrap break-words">{withMarks(text, bodyFrom, text.length, ranges)}</p>
    </div>
  );
}
