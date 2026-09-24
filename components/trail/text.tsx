import type { ReactNode } from "react";
import type { RuleHit } from "@/lib/types";
import { cn } from "@/components/ui/cn";
import { shortPhrase } from "@/lib/format";

const PLACEHOLDER = /(\[[A-Z][A-Z_ ]*\])/g;
const IS_PLACEHOLDER = /^\[[A-Z][A-Z_ ]*\]$/;

/** The redacted text with each placeholder ("[NAME]", "[PHONE]") drawn as a token, so what was hidden is obvious. */
export function RedactedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(PLACEHOLDER);
  return (
    <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed text-ink", className)}>
      {parts.map((p, i) =>
        IS_PLACEHOLDER.test(p) ? (
          <span
            key={i}
            className="mx-px inline-flex items-center rounded-md bg-navy-100 px-1 align-baseline text-xs font-semibold text-navy-900"
          >
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

/** True for a hit found in an earlier message of the thread: the pipeline gives those start and end of -1. */
export function isEarlierHit(hit: RuleHit): boolean {
  return hit.start < 0 || hit.end < 0;
}

function locate(text: string | undefined, hit: RuleHit, search: boolean): TextRange | null {
  if (!text) return null;
  if (!isEarlierHit(hit) && text.slice(hit.start, hit.end) === hit.phrase) return { start: hit.start, end: hit.end };
  // A hit from an earlier message has no position in this text: never guess at an unrelated occurrence.
  if (isEarlierHit(hit) && !search) return null;
  const i = text.toLowerCase().indexOf(hit.phrase.toLowerCase());
  return i >= 0 ? { start: i, end: i + hit.phrase.length } : null;
}

export interface TextRange {
  start: number;
  end: number;
}

/** One cut of the message around one or more matches. `from` and `to` index into the original text. */
export interface Excerpt {
  from: number;
  to: number;
  /** Matches inside this excerpt, in order, never overlapping. */
  marks: TextRange[];
  /** Text before `from` on the same line was cut (show a leading ellipsis). */
  cutStart: boolean;
  /** Text after `to` on the same line was cut (show a trailing ellipsis). */
  cutEnd: boolean;
  /** Index of the line (0 = first line) the excerpt sits on. */
  line: number;
}

/** A sentence end: . ! or ? plus any closing quotes or brackets, followed by white space or the end. */
const SENTENCE_END_SRC = "[.!?][\"')\\]’”]*(?=\\s|$)";

function lineBounds(text: string, at: number): { start: number; end: number; line: number } {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const nl = text.indexOf("\n", at);
  let line = 0;
  for (let i = text.indexOf("\n"); i >= 0 && i < start; i = text.indexOf("\n", i + 1)) line++;
  return { start, end: nl < 0 ? text.length : nl, line };
}

/**
 * Cuts the text into short excerpts around the given ranges. Each excerpt stays on one line (a subject line or a
 * paragraph never runs into the next), prefers whole sentences when they are close, and otherwise cuts at a word
 * boundary. Overlapping matches are merged, and neighbouring sentences on the same line share one excerpt, so four
 * matches in two sentences read as one passage with four marks.
 */
export function excerptsFor(text: string, ranges: TextRange[], radius = 56): Excerpt[] {
  const sorted = ranges
    .filter((r) => r.end > r.start && r.start >= 0 && r.end <= text.length)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const marks: TextRange[] = [];
  for (const r of sorted) {
    const last = marks[marks.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else marks.push({ ...r });
  }

  const windows: Excerpt[] = marks.map((m) => {
    const ln = lineBounds(text, m.start);
    const lineEnd = Math.max(ln.end, m.end);

    // Start: the sentence start when it is close, else a word boundary about `radius` characters back.
    let sentStart = ln.start;
    for (const x of text.slice(ln.start, m.start).matchAll(new RegExp(SENTENCE_END_SRC, "g"))) {
      sentStart = ln.start + (x.index ?? 0) + x[0].length;
    }
    while (sentStart < m.start && /\s/.test(text[sentStart] ?? "")) sentStart++;
    let from = sentStart;
    if (m.start - sentStart > radius * 2) {
      from = Math.max(ln.start, m.start - radius);
      const sp = text.indexOf(" ", from);
      from = sp >= 0 && sp < m.start ? sp + 1 : from;
    }

    // End: the sentence end when it is close, else a word boundary about `radius` characters on.
    const after = text.slice(m.end, lineEnd);
    const endHit = new RegExp(SENTENCE_END_SRC).exec(after);
    let to = endHit ? m.end + endHit.index + endHit[0].length : lineEnd;
    if (to - m.end > radius * 2) {
      to = Math.min(lineEnd, m.end + radius);
      const sp = text.lastIndexOf(" ", to);
      to = sp > m.end ? sp : to;
    }
    return { from, to, marks: [m], cutStart: from > ln.start, cutEnd: to < lineEnd, line: ln.line };
  });

  // Merge windows that overlap, or touch with only spaces between them, on the same line.
  const out: Excerpt[] = [];
  for (const w of windows) {
    const last = out[out.length - 1];
    if (last && last.line === w.line && (w.from <= last.to || /^[^\S\n]*$/.test(text.slice(last.to, w.from)))) {
      if (w.to >= last.to) {
        last.to = w.to;
        last.cutEnd = w.cutEnd;
      }
      last.marks.push(...w.marks);
    } else {
      out.push(w);
    }
  }
  return out;
}

/**
 * Heuristic for "the first line is an email subject": messageText() joins the subject and the body with a blank
 * line. Callers that know should pass `subject` explicitly instead.
 */
export function looksLikeSubject(text: string): boolean {
  const gap = text.indexOf("\n\n");
  if (gap <= 0 || gap > 120) return false;
  const first = text.slice(0, gap);
  return !first.includes("\n") && !/[,;:]\s*$/.test(first);
}

/**
 * The matched words highlighted in their sentences, as one or more short excerpts. Several matches in the same
 * passage share one excerpt with every match marked. Excerpts never cross a line break, and an excerpt on an
 * email's subject line is labelled "Subject:". Marks take their colour from the nearest `data-tone` (globals.css).
 */
export function HitsInContext({
  text,
  hits,
  subject,
  radius = 56,
  earlier = false,
  className,
}: {
  text?: string;
  hits: RuleHit[];
  /** The first line of `text` is an email subject. Defaults to a guess from the text's shape. */
  subject?: boolean;
  radius?: number;
  /** `text` is the earlier thread message these hits came from, so searching it for the phrases is safe. */
  earlier?: boolean;
  className?: string;
}) {
  const located = hits.map((h) => ({ hit: h, at: locate(text, h, earlier) }));
  const ranges = located.flatMap((x) => (x.at ? [x.at] : []));
  const unplaced = Array.from(new Set(located.filter((x) => !x.at).map((x) => x.hit.phrase)));
  const hasSubject = text ? (subject ?? looksLikeSubject(text)) : false;
  const cuts = text && ranges.length ? excerptsFor(text, ranges, radius) : [];

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {text &&
        cuts.map((c) => {
          const parts: ReactNode[] = [];
          let pos = c.from;
          c.marks.forEach((m, i) => {
            if (m.start > pos) parts.push(<span key={`t${i}`}>{text.slice(pos, m.start)}</span>);
            parts.push(<mark key={`m${i}`}>{text.slice(m.start, m.end)}</mark>);
            pos = m.end;
          });
          if (c.to > pos) parts.push(<span key="tail">{text.slice(pos, c.to)}</span>);
          return (
            <p key={c.from} className="whitespace-pre-line break-words text-sm leading-relaxed text-ink">
              {hasSubject && c.line === 0 && <span className="mr-1.5 text-xs font-medium text-muted">Subject:</span>}
              {c.cutStart && "…"}
              {parts}
              {c.cutEnd && "…"}
            </p>
          );
        })}
      {unplaced.length > 0 && (
        <p className="text-sm text-ink">
          {unplaced.map((p, i) => (
            <span key={p}>
              {i > 0 && ", "}
              <q>
                <mark>{shortPhrase(p)}</mark>
              </q>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** A single match highlighted in its sentence. Use HitsInContext for several matches in one passage. */
export function HitInContext({
  text,
  hit,
  radius = 56,
  earlier = false,
  subject,
}: {
  text?: string;
  hit: RuleHit;
  radius?: number;
  /** `text` is the earlier thread message this hit came from, so searching it for the phrase is safe. */
  earlier?: boolean;
  subject?: boolean;
}) {
  return <HitsInContext text={text} hits={[hit]} radius={radius} earlier={earlier} subject={subject} />;
}

const DRAFT_PLACEHOLDER = /(\[(?:FIRST_NAME|AGENT_NAME)\])/g;
const PLACEHOLDER_WORDS: Record<string, string> = { "[FIRST_NAME]": "first name", "[AGENT_NAME]": "your name" };

/**
 * Draft text with any unfilled [FIRST_NAME] or [AGENT_NAME] drawn as a dashed "fill-in" token, so it never reads
 * as a redaction or as text that is ready to send.
 */
export function withDraftPlaceholders(text: string, keyPrefix: string | number): ReactNode[] {
  return text.split(DRAFT_PLACEHOLDER).map((part, i) =>
    PLACEHOLDER_WORDS[part] ? (
      <span
        key={`${keyPrefix}-${i}`}
        title="Filled in by the desk when you send"
        className="mx-px inline-flex items-center rounded-md border border-dashed border-control-line px-1 align-baseline text-xs font-medium text-muted"
      >
        {PLACEHOLDER_WORDS[part]}
      </span>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    ),
  );
}

/**
 * Split draft text on [1] style markers, rendering each marker with the given function. The word before a marker, the
 * marker (or a run of markers) and any punctuation straight after it are kept together in a no-wrap span, so a
 * citation chip never wraps onto a line of its own and a full stop never dangles after it.
 */
export function withCitations(
  text: string,
  renderMarker: (marker: string, key: number) => ReactNode,
  renderText: (text: string, key: number) => ReactNode = (t, key) => <span key={key}>{t}</span>,
): ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  const out: ReactNode[] = [];
  let key = 0;
  let carry = parts[0] ?? "";
  for (let i = 1; i < parts.length; i += 2) {
    // A run of markers with nothing between them ("[1][2]") stays together.
    const markers = [parts[i]];
    let j = i;
    while (j + 2 < parts.length && parts[j + 1] === "") {
      markers.push(parts[j + 2]);
      j += 2;
    }
    const after = parts[j + 1] ?? "";
    // The last word before the marker, with any spaces between it and the marker (a line break stays breakable).
    const w = /(\S+[^\S\n]*)$/.exec(carry);
    const lead = w ? carry.slice(0, w.index) : carry;
    const word = w ? w[1] : "";
    const punct = /^[.,;:!?)\]"'’”]+/.exec(after)?.[0] ?? "";
    if (lead) out.push(renderText(lead, key++));
    out.push(
      <span key={key++} className="whitespace-nowrap">
        {word && renderText(word, key++)}
        {markers.map((m) => renderMarker(m, key++))}
        {punct && renderText(punct, key++)}
      </span>,
    );
    carry = after.slice(punct.length);
    i = j;
  }
  if (carry) out.push(renderText(carry, key++));
  return out;
}
