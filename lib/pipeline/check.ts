/**
 * Step 6: deterministic fact check on an AI draft.
 *
 * Every date, amount, order number, tracking number, time frame and time of day written in the draft must appear in
 * the sources the drafter was given (compared by meaning: dates as day + month, amounts as numbers, durations as
 * number pairs). The draft is also scanned for dosing figures, medical-advice phrases, promotional wording and
 * en or em dash characters. Every sentence also goes through a broad clinical gate, because an agent editing a draft
 * can word advice any way. It works in categories, each with a plain label shown to the agent: dosing advice ("halve
 * it", "use as much as you need"), a symptom played down ("don't worry about the headaches"), a serious symptom
 * ("chest pain"), clinical advice (the patient-message safety lexicon in context), a safety or addiction claim ("you
 * won't get addicted"), and a product claim ("this strain is really calming"). Any failure blocks the draft;
 * clinicianReason() says, in plain words, why the right move is a clinician.
 *
 * Runs in Node, the browser and a Cloudflare Worker (no Node-only APIs).
 */
import type { CheckResult, Currency, FactCheck, FactKind, RuleHit, SourceRef } from "@/lib/types";
import { checkRules } from "./rules";
import { LIVING_PATIENT_RULE_ID } from "./death";

/** The demo year, used when a draft or source writes a date without a year. */
const DEFAULT_YEAR = 2026;

const MONTHS: [string, number][] = [
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6], ["july", 7], ["august", 8],
  ["september", 9], ["october", 10], ["november", 11], ["december", 12],
];
const MONTH_RE = String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)`;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_RE = String.raw`(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tues|Tue|Wed|Thurs|Thur|Thu|Fri|Sat|Sun)`;
const FULL_WEEKDAY_RE = String.raw`(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)`;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function monthIndex(s: string): number {
  const k = s.toLowerCase().slice(0, 3);
  return MONTHS.find(([n]) => n.startsWith(k))?.[1] ?? 0;
}
function weekdayIndex(s: string): number {
  const k = s.toLowerCase().slice(0, 3);
  return WEEKDAYS.findIndex((w) => w.startsWith(k));
}
function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function validDay(m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

// ---------- fact extraction ----------

type Norm =
  | { kind: "date"; d: number; m: number; y?: number; wd?: number; alt?: { d: number; m: number } }
  /**
   * "tomorrow", "next Friday", "on Monday", "by Friday": the calendar dates it can mean, worked out from the demo's
   * today. `wd` is set when a policy that names the weekday ("Monday to Friday") may also support it. `range` is set
   * for a weekday that starts or ends a weekday range ("Monday to Friday"): opening hours, which a policy with the same
   * range, word for word, supports whatever the tense or topic nearby.
   */
  | { kind: "reldate"; dates: { y: number; m: number; d: number }[]; wd?: number; range?: WeekdayRange }
  | { kind: "amount"; value: number; currency: string | null }
  | { kind: "literal"; value: string }
  /**
   * `topics`: what the time frame is about, read from the words around it ("arrive" vs "dispatched"). `late`: the
   * figure says how late something is ("1 business day past its estimated delivery date", "2 business days late").
   */
  | { kind: "duration"; lo: number; hi: number; unit: string; topics?: Topic[]; late?: boolean }
  | { kind: "time"; minutes: number }
  | { kind: "percent"; value: number };

interface Fact {
  text: string;
  kind: FactKind;
  start: number;
  end: number;
  norm: Norm;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, "twenty-four": 24, "forty-eight": 48, "seventy-two": 72,
};
const NUM = String.raw`(?:\d+(?:\.\d+)?|twenty-four|forty-eight|seventy-two|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|thirty|an|a)`;
function numValue(s: string): number {
  const k = s.toLowerCase();
  return k in NUMBER_WORDS ? NUMBER_WORDS[k] : parseFloat(k);
}
function durationUnit(s: string): string {
  const k = s.toLowerCase();
  if (k.startsWith("min")) return "minute";
  if (k.startsWith("h")) return "hour";
  if (k.startsWith("d") || k.startsWith("night")) return "day";
  if (k.startsWith("w")) return "week";
  return "month";
}
function money(s: string): number {
  return Math.abs(parseFloat(s.replace(/,/g, "")));
}
function currencyOf(marker: string): string | null {
  const k = marker.toUpperCase().replace(/\s/g, "");
  if (k === "A$" || k === "AU$" || k === "AUD") return "AUD";
  if (k === "NZ$" || k === "NZD") return "NZD";
  if (k === "US$" || k === "USD") return "USD";
  if (k === "£" || k === "GBP" || k === "POUNDS" || k === "POUND") return "GBP";
  if (k === "€" || k === "EUR") return "EUR";
  return "$"; // "$", "dollars", "bucks": some dollar currency
}

interface Extractor {
  re: RegExp;
  kind: FactKind;
  build: (m: RegExpMatchArray) => Norm | null;
}

const AMOUNT_NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;

const EXTRACTORS: Extractor[] = [
  // record ids
  { re: /\bORD-\d{4,}\b/gi, kind: "order_id", build: (m) => ({ kind: "literal", value: m[0].toUpperCase() }) },
  { re: /\bCD\d{10}\b/gi, kind: "tracking", build: (m) => ({ kind: "literal", value: m[0].toUpperCase() }) },
  { re: /\b(?:CHG|APT|PT|MSG)-\d+\b/gi, kind: "other", build: (m) => ({ kind: "literal", value: m[0].toUpperCase() }) },
  // "Tuesday 22 September 2026", "22nd of Sept", "18 Sep"
  {
    re: new RegExp(
      String.raw`\b(?:(${WEEKDAY_RE})\.?,?\s+(?:the\s+)?)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(${MONTH_RE})\b\.?(?:,?\s+(\d{4})\b)?`,
      "gi",
    ),
    kind: "date",
    build: (m) => {
      const d = +m[2];
      const mo = monthIndex(m[3]);
      if (!validDay(mo, d)) return null;
      return { kind: "date", d, m: mo, y: m[4] ? +m[4] : undefined, wd: m[1] ? weekdayIndex(m[1]) : undefined };
    },
  },
  // "September 22", "Tuesday, September 22, 2026"
  {
    re: new RegExp(String.raw`\b(?:(${WEEKDAY_RE})\.?,?\s+)?(${MONTH_RE})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?`, "gi"),
    kind: "date",
    build: (m) => {
      const d = +m[3];
      const mo = monthIndex(m[2]);
      if (!validDay(mo, d)) return null;
      return { kind: "date", d, m: mo, y: m[4] ? +m[4] : undefined, wd: m[1] ? weekdayIndex(m[1]) : undefined };
    },
  },
  // ISO "2026-09-22"
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    kind: "date",
    build: (m) => (validDay(+m[2], +m[3]) ? { kind: "date", d: +m[3], m: +m[2], y: +m[1] } : null),
  },
  // "22/09/2026", "22/9", "22.09.2026", "22-09-2026" (day first; month first also accepted when day first is impossible)
  {
    re: /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])|\b(\d{1,2})[.-](\d{1,2})[.-](\d{2,4})\b/g,
    kind: "date",
    build: (m) => {
      if (m[0] === "24/7") return null;
      const a = +(m[1] ?? m[4]);
      const b = +(m[2] ?? m[5]);
      const yRaw = m[3] ?? m[6];
      let y: number | undefined = yRaw ? +yRaw : undefined;
      if (y !== undefined && y < 100) y += 2000;
      if (validDay(b, a)) return { kind: "date", d: a, m: b, y, alt: validDay(a, b) ? { d: b, m: a } : undefined };
      if (validDay(a, b)) return { kind: "date", d: b, m: a, y };
      return null;
    },
  },
  // amounts: "$129", "A$129.00", "NZ$89", "£49.99", and "$129.00 AUD" (the code, when written, names the currency)
  {
    re: new RegExp(String.raw`(A\$|AU\$|NZ\$|US\$|\$|£|€)\s?-?${AMOUNT_NUM}(?:\s?(AUD|NZD|GBP|USD|EUR)\b)?`, "gi"),
    kind: "amount",
    build: (m) => ({ kind: "amount", value: money(m[2]), currency: currencyOf(m[3] ?? m[1]) }),
  },
  // "AUD 129.00"
  {
    re: new RegExp(String.raw`\b(AUD|NZD|GBP|USD|EUR)\s?-?${AMOUNT_NUM}`, "gi"),
    kind: "amount",
    build: (m) => ({ kind: "amount", value: money(m[2]), currency: currencyOf(m[1]) }),
  },
  // "129 dollars", "129.00 AUD", "49.99 pounds"
  {
    re: new RegExp(String.raw`(?<![\w.$£])${AMOUNT_NUM}\s?(AUD|NZD|GBP|USD|EUR|dollars?|bucks|pounds?)\b`, "gi"),
    kind: "amount",
    build: (m) => ({ kind: "amount", value: money(m[1]), currency: currencyOf(m[2]) }),
  },
  // times: "5pm", "5:30 pm", "10:30 a.m."
  {
    re: /\b(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)(?![a-z])/gi,
    kind: "time",
    build: (m) => {
      const h = +m[1];
      const min = m[2] ? +m[2] : 0;
      if (h < 1 || h > 12 || min > 59) return null;
      const pm = m[3].toLowerCase().startsWith("p");
      return { kind: "time", minutes: ((h % 12) + (pm ? 12 : 0)) * 60 + min };
    },
  },
  // 24-hour "17:00"
  {
    re: /\b([01]?\d|2[0-3]):([0-5]\d)\b/g,
    kind: "time",
    build: (m) => ({ kind: "time", minutes: +m[1] * 60 + +m[2] }),
  },
  { re: /\b(midday|noon|midnight)\b/gi, kind: "time", build: (m) => ({ kind: "time", minutes: /night/i.test(m[1]) ? 0 : 720 }) },
  // durations: "2 to 5 business days", "3-5 days", "within 24 hours", "one to two weeks", "a 24-hour window"
  {
    re: new RegExp(
      String.raw`\b(?:(within|in|about|around|up to|under|over|another|next)\s+)?(${NUM})(?:\s*(?:to|-|\u2013|\u2014|or|and)\s*(${NUM}))?(?:\s+|-)(?:(?:business|working|calendar|full|more)\s+)?(minutes?|mins?|hours?|hrs?|days?|nights?|weeks?|months?)\b`,
      "gi",
    ),
    kind: "duration",
    build: (m) => {
      const loWord = m[2].toLowerCase();
      if ((loWord === "a" || loWord === "an") && !m[1]) return null; // "have a day off" is not a time frame
      const lo = numValue(m[2]);
      const hi = m[3] ? numValue(m[3]) : lo;
      if (Number.isNaN(lo) || Number.isNaN(hi)) return null;
      return { kind: "duration", lo: Math.min(lo, hi), hi: Math.max(lo, hi), unit: durationUnit(m[4]) };
    },
  },
  // percentages
  {
    re: /\b(\d+(?:\.\d+)?)\s?(?:%|per\s?cent\b)/gi,
    kind: "other",
    build: (m) => ({ kind: "percent", value: parseFloat(m[1]) }),
  },
];

// ---------- relative dates ----------

/** The demo's "today": Wednesday 23 September 2026. Callers may pass another date; the check never reads a clock. */
export const DEMO_TODAY = "2026-09-23";

type Ymd = { y: number; m: number; d: number };

function parseToday(iso: string): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : parseToday(DEMO_TODAY);
}
function addDays(t: Ymd, n: number): Ymd {
  const dt = new Date(Date.UTC(t.y, t.m - 1, t.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Verbs that turn "today" into a claim ("it will arrive today"), rather than small talk ("thanks for writing today"). */
const TODAY_CLAIM = /\b(?:arriv\w*|deliver\w*|ship\w*|dispatch\w*|post(?:ed|ing)?|sent|send\w*|charg\w*|bill\w*|refund\w*|process\w*|due|expect\w*|book\w*|appointment|consult\w*|renew\w*|approv\w*|leav\w*|land\w*|reach\w*|with you)\b/i;

/**
 * The tense of the words before a weekday, which decides the date it means. A past auxiliary wins ("it was due on
 * Tuesday", "should have arrived by Monday"), then a future modal ("will be delivered on Friday"), then a past verb
 * ("shipped on Monday"), then weaker future words ("arrives on", "by Friday", "be with you"). Null when nothing says.
 */
type Tense = "past" | "future";
const PAST_AUX = /\b(?:was|were|had|did|has been|have been|(?:should|would|could|must|might|may)(?:\s+not)?\s+have)\b/i;
const FUTURE_MODAL = /\b(?:will|shall|should|going to|gonna|expect\w*|due|scheduled|set to|booked (?:for|in)|can|could|would)\b|['’]ll\b/i;
const PAST_VERB = /\b(?:arrived|delivered|shipped|dispatched|posted|sent|went|came|left|placed|charged|processed|missed|received|refunded|approved|renewed|cancelled|canceled|paused|since|ago|last)\b/i;
const FUTURE_WORD = /\b(?:arriv(?:e|es|ing)|deliver(?:s|ing)?|be with you|by|until|till|from|coming|upcoming|next)\b/i;

function tenseOf(text: string): Tense | null {
  if (PAST_AUX.test(text)) return "past";
  if (FUTURE_MODAL.test(text)) return "future";
  if (PAST_VERB.test(text)) return "past";
  if (FUTURE_WORD.test(text)) return "future";
  return null;
}

/** The tense of the clause before an index, failing that the clause after it, failing that the whole sentence. */
function tenseNear(text: string, start: number, end: number): Tense | null {
  const before = text.slice(Math.max(0, start - 100), start);
  let cut = 0;
  for (const m of before.matchAll(CLAUSE_BACK)) cut = (m.index ?? 0) + m[0].length;
  const back = tenseOf(before.slice(cut));
  if (back) return back;
  const after = text.slice(end, end + 60);
  const stop = CLAUSE_FORWARD.exec(after);
  return tenseOf(stop ? after.slice(0, stop.index) : after) ?? tenseOf(sentenceAt(text, start, end));
}

function relativeExtractors(today: Ymd): Extractor[] {
  const wdToday = weekdayOf(today.y, today.m, today.d);
  const next = (wd: number, min: number) => {
    // The first date on or after today + min days that falls on this weekday.
    for (let i = min; i < min + 7; i++) {
      const t = addDays(today, i);
      if (weekdayOf(t.y, t.m, t.d) === wd) return t;
    }
    return today;
  };
  const prev = (wd: number) => {
    // The last date before today that falls on this weekday.
    for (let i = 1; i <= 7; i++) {
      const t = addDays(today, -i);
      if (weekdayOf(t.y, t.m, t.d) === wd) return t;
    }
    return today;
  };
  return [
    {
      re: new RegExp(String.raw`\b(this|next|coming|this coming)\s+(${FULL_WEEKDAY_RE})\b`, "gi"),
      kind: "date",
      build: (m) => {
        const which = m[1].toLowerCase();
        const wd = weekdayIndex(m[2]);
        if (which === "next") {
          // "next Friday" said on a Wednesday can mean the 25th or the Friday after; accept either.
          const first = next(wd, 1);
          return { kind: "reldate", dates: [first, addDays(first, 7)] };
        }
        return { kind: "reldate", dates: [next(wd, 0)] };
      },
    },
    {
      re: /\b(today|tomorrow|yesterday)\b/gi,
      kind: "date",
      build: (m) => {
        const w = m[1].toLowerCase();
        const offset = w === "tomorrow" ? 1 : w === "yesterday" ? -1 : 0;
        return { kind: "reldate", dates: [addDays(today, offset)] };
      },
    },
    {
      // A weekday on its own or after "on": "it should arrive by Friday", "it shipped on Monday". The tense picks the
      // date: ahead means the next one on or after today, looking back means the last one before today, and only with
      // no tense at all are both accepted. Said on the same weekday, it can also mean today. A weekday is never
      // matched against a source date that merely falls on the same weekday.
      re: new RegExp(String.raw`\b(?:on\s+)?(${FULL_WEEKDAY_RE})\b`, "gi"),
      kind: "date",
      build: (m) => {
        const wd = weekdayIndex(m[1]);
        const input = m.input ?? "";
        const start = m.index ?? 0;
        const end = start + m[0].length;
        const tense = tenseNear(input, start, end);
        const same = wd === wdToday;
        let dates: Ymd[];
        if (tense === "future") dates = same ? [today, addDays(today, 7)] : [next(wd, 0)];
        else if (tense === "past") dates = same ? [today, prev(wd)] : [prev(wd)];
        else dates = same ? [today, prev(wd), next(wd, 1)] : [next(wd, 0), prev(wd)];
        // A policy that names the weekday ("our team replies Monday to Friday") can support opening hours, but never
        // the day a parcel arrives, ships or a refund lands.
        const aboutParcel = topicsNear(input, start, end).length > 0;
        // A weekday that starts or ends a range ("Consults run Monday to Friday ..., so the team will confirm it with
        // you") is opening hours, not a day something happens: kept for a policy with the same range (MSG-0185).
        const range = weekdayRange(input, start, end, m[1]);
        return { kind: "reldate", dates, wd: tense && aboutParcel ? undefined : wd, ...(range ? { range } : {}) };
      },
    },
  ];
}

/** A weekday range as written ("Monday to Friday"), lower case: first day, the joining word ("to", or "-"), last day. */
interface WeekdayRange {
  from: string;
  join: string;
  to: string;
}
const RANGE_JOIN = String.raw`(?:\s+(to|through|until|till)\s+|\s*(-)\s*)`;
const RANGE_AFTER_RE = new RegExp(String.raw`^${RANGE_JOIN}(${FULL_WEEKDAY_RE})\b`, "i");
const RANGE_BEFORE_RE = new RegExp(String.raw`\b(${FULL_WEEKDAY_RE})${RANGE_JOIN}$`, "i");

/**
 * The range a weekday starts ("Monday" in "Monday to Friday") or ends ("Friday"), or undefined for a weekday on its
 * own ("it should arrive by Friday", "a Thursday or Friday time").
 */
function weekdayRange(input: string, start: number, end: number, day: string): WeekdayRange | undefined {
  const after = RANGE_AFTER_RE.exec(input.slice(end));
  if (after) return { from: day.toLowerCase(), join: (after[1] ?? after[2]).toLowerCase(), to: after[3].toLowerCase() };
  const before = RANGE_BEFORE_RE.exec(input.slice(Math.max(0, start - 30), start));
  if (before) return { from: before[1].toLowerCase(), join: (before[2] ?? before[3]).toLowerCase(), to: day.toLowerCase() };
  return undefined;
}

/** True when a source's text holds the same weekday range, word for word ("Monday to Friday 8 am to 8 pm"). */
function hasWeekdayRange(lower: string, r: WeekdayRange): boolean {
  const join = r.join === "-" ? String.raw`\s*-\s*` : String.raw`\s+${r.join}\s+`;
  return new RegExp(String.raw`\b${r.from}${join}${r.to}\b`, "i").test(lower);
}

/**
 * A time frame that says how late something is: "1 business day past its estimated delivery date", "2 business days
 * late", "5 business days past, or ...", "3 days after the ETA". Not "1 to 2 business days after the billing date".
 */
const LATE_AFTER_RE =
  /^\s+(?:past\b|late\b|overdue\b|behind\b|(?:after|beyond)\s+(?:its|the|that|your|this)\s+(?:(?:estimated|expected|original|scheduled)\s+)?(?:delivery\s+)?(?:date|ETA|estimate)\b)/i;

// ---------- what a time frame is about ----------

/**
 * "1 to 2 business days" means one thing after "dispatched" and another after "arrive". A draft's time frame only
 * matches a source time frame about the same thing, or one whose words do not say (a table row such as
 * "Australia, metro: 1 to 3 business days").
 */
type Topic = "delivery" | "dispatch" | "refund";
const TOPIC_WORDS: [Topic, RegExp][] = [
  ["delivery", /\b(?:arriv\w*|deliver\w*|reach\w*|get to you|gets to you|with you|in transit|transit|turn(?:s|ed)? up|eta|land\w*)\b/i],
  ["dispatch", /\b(?:dispatch\w*|ship|ships|shipped|shipping|post|posts|posted|sent|send\w*|pack\w*|dispens\w*|go(?:es)? out|leav\w*)\b/i],
  ["refund", /\b(?:refund\w*|money back|back (?:on|to) (?:your|the) card)\b/i],
];
const CLAUSE_BACK = /[.!?;\n,:(]|\b(?:and|but|then|so|or)\b/gi;
const CLAUSE_FORWARD = /[.!?;\n,:)]|\b(?:and|but|then|so|or)\b/i;

function topicsIn(text: string): Topic[] {
  return TOPIC_WORDS.filter(([, re]) => re.test(text)).map(([t]) => t);
}

/**
 * Topics of the clause before the figure ("should arrive in"), failing that the words after it ("to arrive"), and
 * failing that the whole sentence ("Refunds go back to the card and take 5 to 10 business days").
 */
function topicsNear(text: string, start: number, end: number): Topic[] {
  const before = text.slice(Math.max(0, start - 100), start);
  let cut = 0;
  for (const m of before.matchAll(CLAUSE_BACK)) cut = (m.index ?? 0) + m[0].length;
  const back = topicsIn(before.slice(cut));
  if (back.length > 0) return back;
  const after = text.slice(end, end + 60);
  const stop = CLAUSE_FORWARD.exec(after);
  const forward = topicsIn(stop ? after.slice(0, stop.index) : after);
  if (forward.length > 0) return forward;
  return topicsIn(sentenceAt(text, start, end));
}

function sameTopic(a: Topic[] | undefined, b: Topic[] | undefined): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return true;
  return a.some((t) => b.includes(t));
}

/** The sentence around an index, for deciding whether "today" is a claim. */
function sentenceAt(text: string, start: number, end: number): string {
  let a = start;
  while (a > 0 && !/[.!?\n]/.test(text[a - 1])) a--;
  let b = end;
  while (b < text.length && !/[.!?\n]/.test(text[b])) b++;
  return text.slice(a, b);
}

function extractFacts(text: string, today: Ymd = parseToday(DEMO_TODAY)): Fact[] {
  const out: Fact[] = [];
  const claimed: [number, number][] = [];
  const free = (s: number, e: number) => claimed.every(([a, b]) => e <= a || s >= b);
  for (const ex of [...EXTRACTORS, ...relativeExtractors(today)]) {
    for (const m of text.matchAll(ex.re)) {
      if (m.index === undefined) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (!free(start, end)) continue;
      const norm = ex.build(m);
      if (!norm) continue;
      if (norm.kind === "duration") {
        norm.topics = topicsNear(text, start, end);
        if (LATE_AFTER_RE.test(text.slice(end))) norm.late = true;
      }
      if (/^today$/i.test(m[0]) && !TODAY_CLAIM.test(sentenceAt(text, start, end))) continue;
      claimed.push([start, end]);
      // Report the fact as written, without a sentence full stop or comma picked up after "Sep." style months.
      const written = m[0].trim();
      out.push({ text: /[ap]\.m\.$/i.test(written) ? written : written.replace(/[.,]$/, ""), kind: ex.kind, start, end, norm });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------- matching ----------

interface SourceFacts {
  source: SourceRef;
  lower: string;
  facts: Norm[];
}

function sameCurrency(a: string | null, b: string | null): boolean {
  if (!a || !b || a === b) return true;
  const dollar = new Set(["$", "AUD", "NZD", "USD"]);
  if (a === "$") return dollar.has(b);
  if (b === "$") return dollar.has(a);
  return false;
}

/**
 * An amount written in a currency marker ("£112", "NZ$236", "$50" for a UK patient) that is not the patient's own
 * currency. A bare "$" fits either dollar currency; an amount with no marker at all fits anything.
 */
function fitsPatient(currency: string | null, patientCurrency: Currency | null): boolean {
  if (!patientCurrency || !currency) return true;
  if (currency === "$") return patientCurrency !== "GBP";
  return currency === patientCurrency;
}

/**
 * The patient's currency, from `opts.currency` or else from the patient's own records (the plan, orders and
 * charges are always written with their code: "$129.00 AUD", "£49.90"). Null when the records disagree or say
 * nothing, and then no currency rule applies.
 */
function patientCurrencyOf(sources: SourceFacts[], given?: Currency): Currency | null {
  if (given) return given;
  const found = new Set<string>();
  for (const s of sources) {
    if (s.source.kind === "policy") continue;
    for (const f of s.facts) if (f.kind === "amount" && f.currency && f.currency !== "$") found.add(f.currency);
  }
  const [only] = [...found];
  return found.size === 1 && (only === "AUD" || only === "NZD" || only === "GBP") ? only : null;
}

function matches(fact: Norm, s: SourceFacts, patientCurrency: Currency | null = null): boolean {
  switch (fact.kind) {
    case "literal":
      // Whole ids only, so a truncated "ORD-2001" is not found inside "ORD-20011".
      return s.source.id.toUpperCase() === fact.value || new RegExp(String.raw`(?<![\w-])${escapeRe(fact.value)}(?![\w-])`, "i").test(s.lower);
    case "reldate":
      return (
        s.facts.some(
          (f) => f.kind === "date" && fact.dates.some((c) => c.d === f.d && c.m === f.m && c.y === (f.y ?? DEFAULT_YEAR)),
        ) ||
        // "on Monday" also matches a policy that names the weekday ("our team replies Monday to Friday").
        (fact.wd !== undefined && s.source.kind === "policy" && s.lower.includes(WEEKDAYS[fact.wd])) ||
        // "Monday to Friday" matches a policy with the same range, word for word.
        (fact.range !== undefined && s.source.kind === "policy" && hasWeekdayRange(s.lower, fact.range))
      );
    case "date":
      return s.facts.some((f) => {
        if (f.kind !== "date") return false;
        const candidates = [{ d: fact.d, m: fact.m }, ...(fact.alt ? [fact.alt] : [])];
        return candidates.some((c) => {
          if (c.d !== f.d || c.m !== f.m) return false;
          // A year-less source date ("18 Sep" in a label) is read as the demo year.
          if (fact.y !== undefined && fact.y !== (f.y ?? DEFAULT_YEAR)) return false;
          if (fact.wd !== undefined && fact.wd >= 0) {
            return weekdayOf(fact.y ?? f.y ?? DEFAULT_YEAR, c.m, c.d) === fact.wd;
          }
          return true;
        });
      });
    case "amount":
      if (!fitsPatient(fact.currency, patientCurrency)) return false;
      return s.facts.some(
        (f) =>
          f.kind === "amount" &&
          Math.abs(f.value - fact.value) < 0.005 &&
          sameCurrency(fact.currency, f.currency) &&
          // "Refunds over A$250, NZ$270 or £150": another country's figure is not a source for this patient.
          fitsPatient(f.currency, patientCurrency),
      );
    case "duration":
      return s.facts.some(
        (f) =>
          f.kind === "duration" &&
          f.unit === fact.unit &&
          sameTopic(fact.topics, f.topics) &&
          // How late something is ("1 business day past its estimated delivery date", an order record's status line, or
          // P4.2's "2 business days past the ETA") supports only a lateness figure, never a promise such as "arrives in
          // 1 business day"; and a lateness figure needs one of those, not an unrelated time frame.
          !!f.late === !!fact.late &&
          // Same range, or a single figure that is the upper end of the source range ("up to 5 business days").
          ((f.lo === fact.lo && f.hi === fact.hi) ||
            (fact.lo === fact.hi && fact.hi === f.hi) ||
            // A single figure inside a source range ("pause for 1 month" within "paused for 1 to 3 months"). Not for a
            // delivery, dispatch or refund time frame: there a figure inside the range is a promise the policy does not
            // make ("arrives in 3 business days" against "2 to 5 business days").
            (fact.lo === fact.hi &&
              f.lo < f.hi &&
              fact.lo >= f.lo &&
              fact.hi <= f.hi &&
              (fact.topics ?? []).length === 0 &&
              (f.topics ?? []).length === 0)),
      );
    case "time":
      return s.facts.some((f) => f.kind === "time" && f.minutes === fact.minutes);
    case "percent":
      return s.facts.some((f) => f.kind === "percent" && Math.abs(f.value - fact.value) < 1e-9);
  }
}

// ---------- banned content ----------

const DOSE_UNIT = String.raw`(?:mg|mcg|µg|milligrams?|ml|mls|millilitres?|milliliters?|drops?|sprays?|puffs?|capsules?|caps|tablets?|gummies|grams?|g)`;
const DOSE_FIGURE = String.raw`\d+(?:[.,]\d+)?\s?${DOSE_UNIT}\b`;

/** What a patient takes, as an agent might name it. */
const MEDICINE_NOUN = String.raw`(?:the|your|this|that)\s+(?:oil|oils|capsules?|caps|spray|sprays|drops|gummies|tincture|flower|product|medicine|medication|meds|treatment|dose|doses|dosage|prescription|script|tablets?|vape|cartridge)`;
const MEDICINE_OBJECT = String.raw`(?:it|them|${MEDICINE_NOUN})\b`;
/** Symptom and reaction words, for reassurance ("that dizziness is normal"). */
const SYMPTOM = String.raw`(?:reactions?|symptoms?|side effects?|dizz\w*|nause\w*|drows\w*|sleepiness|grogg\w*|rash(?:es)?|headaches?|migraines?|itch\w*|swelling|palpitations?|racing heart|dry mouth|anxiety|paranoia|sickness|vomiting|upset stomach|stomach ache|tummy|tiredness|fatigue|fogg\w*|brain fog|light.?headedness|shak\w*|tremors?|feeling (?:sick|off|strange|weird|funny|high|spaced out))`;

/**
 * The app, a browser, a card or a photo after "try using", "keep taking" and similar: support steps, not the medicine
 * ("try using a different browser", "keep taking screenshots", "try taking a photo of the label"). Up to two words
 * may sit in between ("the same login", "the old tracking link"). "Tablet" is left out: it can be the medicine.
 */
const SUPPORT_NOUN = String.raw`(?:apps?|browsers?|links?|cards?|web\w*|sites?|chrome|safari|firefox|edge|devices?|phones?|laptops?|computers?|e-?mails?|logins?|log-?ins?|passwords?|reset|photos?|pictures?|screenshots?|snaps?|notes?|look|care|time|steps|wi-?fi|data|incognito|mobile|desktop|address|payments?|accounts?|portal|code|buttons?|pages?|chat|tracking)`;
/** Up to two words between the verb and the app word, never "it", "them" or a medicine word ("keep taking them each time"). */
const SUPPORT_GAP = String.raw`(?:(?!(?:it|them|oils?|capsules?|caps|sprays?|drops|gumm(?:y|ies)|tinctures?|flower|medicines?|medications?|meds|doses?|dosage|tablets?|vapes?|products?|cannabis|CBD|THC)\b)[\w'’-]+\s+){0,2}?`;
const NOT_SUPPORT_OBJECT = String.raw`(?!\s+(?:(?:the|a|an|your|our|another|different|this|that|some|more|any)\s+)?${SUPPORT_GAP}${SUPPORT_NOUN}\b)`;
/** The narrower set for the words after a lexicon hit ("stop using the old tracking link"): no "time" or "care". */
const TECH_NOUN = String.raw`(?:apps?|browsers?|links?|cards?|web\w*|sites?|chrome|safari|firefox|devices?|phones?|laptops?|computers?|e-?mails?|logins?|log-?ins?|passwords?|portal|accounts?|code|pages?|chat|tracking|form|screenshots?|photos?|pictures?)`;
/** "It's safe to delete the old app", "it is safe to ignore that reminder": an app or account step, not the medicine. */
const SAFE_TO_ROUTINE = String.raw`\s+(?:ignore|delete|disregard|update|reinstall|uninstall|close|restart|refresh|reset|log (?:out|in|off)|sign (?:out|in)|unsubscribe|clear (?:the|your) (?:cache|browser|cookies|history)|remove the (?:old )?app|throw (?:away|out) the (?:old )?(?:e-?mails?|packaging|box|login|letter|envelope)|recycle the (?:box|packaging)|bin the (?:box|packaging))\b`;
const NOT_SAFE_TO_ROUTINE = String.raw`(?!${SAFE_TO_ROUTINE})`;
const SAFE_TO_ROUTINE_RE = new RegExp(String.raw`^${SAFE_TO_ROUTINE}`, "i");

interface BannedRule {
  label: string;
  re: RegExp;
  /** Which part of the match to report: the whole match, or a capture group. */
  group?: number;
}

const BANNED_RULES: BannedRule[] = [
  // dosing figures in an instruction context
  {
    label: "dosing figure",
    re: new RegExp(
      String.raw`\b(?:take|taking|use|using|try|trying|start(?:ing)?(?:\s+(?:on|with|at))?|increase|increasing|decrease|reduce|reducing|up|double|place|put|squirt|administer|consume|dose)\b[^.!?\n]{0,30}?\b(${DOSE_FIGURE})`,
      "gi",
    ),
    group: 1,
  },
  {
    label: "dosing figure",
    re: new RegExp(
      String.raw`\b(${DOSE_FIGURE})\s*(?:a|per|each|every|twice|once|three times|in the|at|under)\s+(?:day|daily|night|morning|evening|dose|hours?|tongue)\b`,
      "gi",
    ),
    group: 1,
  },
  { label: "dosing figure", re: /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|milligrams?)\b/gi },
  { label: "dosing figure", re: /\b(?:\d+|a few|few|a couple of|couple of|one|two|three|four|five|six|ten)\s+drops?\b/gi },
  // A number of another medicine: "take two paracetamol", "a couple of Panadol".
  {
    label: "dosing figure",
    re: /\b(?:\d+|a couple of|couple of|a few|one|two|three|four|five|six)\s+(?:paracetamol|panadol|nurofen|ibuprofen|aspirins?|codeine|panadeine|antihistamines?|melatonin|valium|diazepam|tramadol|endone|oxycodone|sleeping (?:pills|tablets)|pain ?killers?|(?:pain )?(?:pills|tablets))\b/gi,
  },
  { label: "dosing figure", re: /\bunder (?:your|the) tongue\b/gi },
  // medical advice
  {
    label: "medical advice",
    re: new RegExp(
      String.raw`\b(?:you should (?:take|use|try|stop|start|increase|reduce|lower|avoid|keep)|(?:increase|reduce|lower|decrease|double|halve|up|change) your (?:dose|dosage|intake|drops)|it(?:'|’)?s safe to${NOT_SAFE_TO_ROUTINE}|it is safe to${NOT_SAFE_TO_ROUTINE}|it should be safe|safe to (?:take${NOT_SUPPORT_OBJECT}|use${NOT_SUPPORT_OBJECT}|drive|mix|combine|drink)|(?:stop|keep|start) taking${NOT_SUPPORT_OBJECT}|try (?:taking|using)${NOT_SUPPORT_OBJECT}|take it with|you can (?:take|mix|combine) it|won(?:'|’)?t interact|no (?:known )?interactions?|will (?:help|relieve|cure|fix) (?:your|with)|should help (?:your|with))\b`,
      "gi",
    ),
  },
  // Medical advice in an agent's own words (the edit path). Tuned to over-block: a false stop costs one rewrite, a
  // missed one sends clinical advice to a patient. Each needs a medicine word, a dose word or a symptom nearby.
  {
    // Instructions about using the product: "stop using the oil", "keep taking it", "carry on with the spray".
    label: "medical advice",
    re: new RegExp(
      String.raw`\b(?:stop|keep|start|continue|carry on|pause|resume|restart|avoid|skip)\s+(?:using|taking|with)\s+${MEDICINE_OBJECT}`,
      "gi",
    ),
  },
  {
    // Changes to the amount: "double the amount", "use a little less", "take a smaller amount", "cut back on it".
    // "The amount" alone is also a billing word, so it counts only as an instruction ("feel free to double the amount").
    label: "medical advice",
    re: new RegExp(
      [
        String.raw`\b(?:double|halve|increase|decrease|reduce|lower|raise|up|adjust|split)\s+(?:the|your)\s+(?:dose|dosage|doses|intake|drops|serve|serving)\b`,
        String.raw`\b(?:feel free to|you can|you could|you may|try to|try|just|go ahead and|it(?:'|’)s fine to|it is fine to)\s+(?:double|halve|increase|decrease|reduce|lower|raise|up|change|adjust|split)\s+(?:the|your)\s+amount\b`,
        String.raw`(?:^|[.!?]\s+)(?:double|halve|increase|decrease|reduce|lower)\s+(?:the|your)\s+amount\b`,
        String.raw`\b(?:use|take|try)\s+(?:a\s+(?:little|bit|touch)\s+|slightly\s+|much\s+)?(?:less|more|a smaller amount|a larger amount|a lower dose|a higher dose|a smaller dose|a bigger dose|half(?: as much| the amount| a dose)?|twice as much|an extra (?:dose|drop|capsule|spray))\b(?!\s+(?:questions?|than|information|info|details|time|days|help|care|of (?:our|the) (?:app|site|website|portal)))`,
        String.raw`\bcut (?:down|back) on ${MEDICINE_OBJECT}`,
      ].join("|"),
      "gim",
    ),
  },
  {
    // Safety reassurance: "it's fine to drive", "okay to drink", "safe to keep using", "with your other medicine".
    label: "medical advice",
    re: new RegExp(
      [
        String.raw`\b(?:fine|okay|ok|safe|alright|all right|no problem|not a problem)\s+to\s+(?:drive|drink|mix|combine|double|take|operate|ride|fly|cycle|use (?:heavy |any )?(?:machinery|machines|equipment|power tools|tools)|work (?:with|on) (?:machinery|machines)|have (?:a (?:drink|glass|beer|wine)|alcohol|it|them|wine|beer)|keep (?:using|taking)|continue (?:using|taking)|carry on (?:using|taking)|use (?:it|them|${MEDICINE_NOUN})|stop (?:using|taking))\b`,
        String.raw`\b(?:with|alongside)\s+(?:alcohol|wine|beer|a drink|a glass of \w+|your other (?:medicines?|medications?|meds|tablets|pills|treatments?)|other (?:medicines?|medications?|meds)|food|a meal|meals|your meals)\b`,
        String.raw`\b(?:a glass of \w+|a drink|a beer|alcohol|wine)\s+with (?:it|them|your (?:dose|oil|capsules?|spray|medicine))\b`,
        String.raw`\byou can (?:have|drink|enjoy) (?:a (?:glass of )?(?:wine|beer|drink)|alcohol|wine|beer)\b`,
        String.raw`\b(?:drive|driving)\s+(?:after|while (?:using|taking)|when (?:using|taking))\s+(?:it|them|your|the)\b`,
      ].join("|"),
      "gi",
    ),
  },
  {
    // Reassurance about symptoms: "that reaction is normal", "nothing to worry about", "should stop the nausea".
    label: "medical advice",
    re: new RegExp(
      [
        String.raw`\b${SYMPTOM}\b[^.!?\n]{0,50}?\b(?:is|are|it(?:'|’)s|that(?:'|’)s|sounds|seems)\s+(?:quite |very |completely |perfectly |pretty |totally |usually |often )?(?:normal|common|expected|harmless|nothing to worry about)\b`,
        String.raw`\b(?:normal|common|expected)\s+to\s+(?:feel|get|have|experience|notice)\b`,
        // "nothing to worry about" on its own is left to the gate below, so "no need to worry, your parcel is safe" passes.
        String.raw`\b(?:should|will|would|can|may|might|often|usually)\s+(?:stop|ease|settle|help|relieve|reduce|fix|clear|clear up|calm|pass|wear off|go away|improve)\s+(?:the |your |any )?${SYMPTOM}\b`,
        String.raw`\b${SYMPTOM}\s+(?:should|will|usually|often)\s+(?:settle|pass|ease|wear off|go away|clear|improve)\b`,
        String.raw`\bsee if (?:the |your )?${SYMPTOM}\s+(?:settles?|eases?|improves?|goes away|passes|clears)\b`,
      ].join("|"),
      "gi",
    ),
  },
  {
    // Doses written in words: "two capsules at night", "half a dropper", "a full dropper".
    label: "dosing figure",
    re: /\b(?:one|two|three|four|five|six|a couple of|a few|half(?: of)?|a half|a quarter|quarter of|one and a half)\s+(?:an?\s+)?(?:full\s+)?(?:capsules?|caps|tablets?|gumm(?:y|ies)|droppers?(?:ful)?s?|dropperfuls?|sprays?|puffs?|pumps?|squirts?|mls?|millilitres?|teaspoons?)\b(?!\s*(?:bottles?|packs?|pots?|jars?|boxes?|tubs?|orders?|products?|lines?|refills?))|\b(?:a|one)\s+full\s+dropper(?:ful)?\b/gi,
  },
  // promotion and efficacy claims
  {
    label: "promotional wording",
    re: /\b(?:strongest|high[- ]THC|best strains?|potent|potency|most effective|clinically proven|miracle|cures?|works wonders|guaranteed to|(?:the )?best on the market|best (?:products?|oils?|flower|quality|range) (?:available|around|on the market|out there|in (?:Australia|New Zealand|the UK|the country))|the best (?:there is|money can buy)|number one (?:product|brand|oil|choice)|market[- ]leading|top[- ]quality|premium[- ]quality|highest[- ]quality|unbeatable)\b/gi,
  },
];

// ---------- clinical gate (broad, for an agent's own words) ----------

/**
 * The rules above catch known phrasings. An agent can always word advice another way ("have a break from the oil",
 * "drinking is fine in moderation"), so every sentence also goes through a broad gate built on the same safety
 * lexicon that stops patient messages (lib/pipeline/rules.ts: side effects, doses, alcohol, driving, pregnancy,
 * other medicines). A sentence is stopped when that lexicon fires together with a medicine word, "it" or "them", a
 * use verb or a reassurance word. Tuned to over-block: a false stop costs one rewrite or an escalation, a miss sends
 * clinical advice to a patient.
 */
const MED_WORD = String.raw`(?:oils?|capsules?|caps|sprays?|drops|gumm(?:y|ies)|tinctures?|flower|medicines?|medications?|meds|treatment(?!\s+plan)|doses?|dosage|tablets?|vapes?|cartridges?|cannabis|CBD|THC|cannabinoids?|products?|blends?)`;
const MED_WORD_RE = new RegExp(String.raw`\b${MED_WORD}\b`, "i");
const PRONOUN_RE = /\b(?:it|them)\b/i;
const USE_VERB_RE =
  /\b(?:take|takes|taking|took|use|uses|using|used|try|trying|have|having|skip\w*|stop\w*|paus\w*|hold off|mix\w*|combin\w*|drink\w*|drive|drives|driving|drove|double|halve|start\w*|keep|continu\w*|carry on|avoid\w*)\b/i;
const VERDICT_RE =
  /\b(?:fine|ok|okay|safe|safely|alright|all right|no problem|not a problem|normal|common|usual|expected|harmless|typical|nothing to worry|no need|in moderation|be right|be sweet|be grand|good to go|right to|clear to|won['’]?t|will not|doesn['’]?t|does not|isn['’]?t|shouldn['’]?t|should not|passes|pass|wears? off|settles?|goes away|go away|at first|you can|you could|you may|can still|should be|all good|no issue|not an issue|no dramas|won['’]?t matter|doesn['’]?t matter|(?:happy|fine|okay|ok|content|comfortable|alright) (?:for|with) you to|(?:happy|fine|okay|ok|alright) with (?:you|that|it)|approved? (?:of )?(?:you|it)|gave (?:you )?the (?:all clear|go ahead|green light)|all clear|go[- ]ahead|green light)\b/i;
/** A sentence that hands the question to a clinician ("a clinician will call you about the dizziness"). */
const HANDOVER_RE = /\b(?:clinicians?|doctors?|GPs?|nurses?|pharmacists?|prescribers?|clinical team|medical team|care team|vets?)\b/i;
/**
 * Where a new clause starts inside one sentence, so a hand-over excuses only its own clause: "a clinician will call;
 * until then take an antihistamine", "pop a Panadol and a clinician will call", "our clinician will call, but the chest
 * pain is likely muscular". A list of symptoms after a hand-over ("about the jerking and the bitten tongue") has no verb
 * of its own, so it stays in the hand-over's clause.
 */
const CLAUSE_SUBJECT = String.raw`(?:(?:a|an|the|our|your|my|his|her|their|this|that|these|those|one of (?:our|the|your))\s+(?:[\w'’-]+\s+){0,2}?[\w'’-]+|I|we|you|they|he|she|it|someone|somebody|one of (?:them|us))`;
const CLAUSE_MODAL = String.raw`(?:will|would|can|could|should|may|might|must|is|are|was|were|has|have|had|does|do|did|won['’]?t|can['’]?t|isn['’]?t|aren['’]?t|tends?|usually|often|always|normally|generally|mostly)`;
const CLAUSE_IMPERATIVE = String.raw`(?:just\s+|please\s+|simply\s+|maybe\s+|feel free to\s+)?(?:take|have|use|try|pop|grab|drink|keep|stop|skip|start|give|avoid|double|halve|mix|swap|switch|go|leave|hold|add|chuck)\b`;
const CLAUSE_BREAK_RE = new RegExp(
  [
    String.raw`[;:]`,
    String.raw`\b(?:but|though|although|however|meanwhile|whereas|otherwise|except that|in the meantime|in the mean ?time|until then|till then|before then|for now|in any case|either way)\b`,
    String.raw`,\s*(?=(?:and|so|then|plus)\b)`,
    String.raw`\b(?:and|so|then|plus|or)\s+(?=${CLAUSE_SUBJECT}\s+${CLAUSE_MODAL}\b|${CLAUSE_SUBJECT}['’](?:ll|s|re|ve|d)\b|${CLAUSE_IMPERATIVE})`,
    String.raw`,\s*(?=${CLAUSE_IMPERATIVE}|${CLAUSE_SUBJECT}\s+${CLAUSE_MODAL}\b|${CLAUSE_SUBJECT}['’](?:ll|s|re|ve|d)\b)`,
  ].join("|"),
  "gi",
);
/** Words just before another medicine that make it advice, even inside a hand-over ("your GP can prescribe you melatonin"). */
const RECOMMEND_BEFORE_RE =
  /\b(?:prescrib\w*|recommend\w*|suggest\w*|advis\w*|put you on|start you on|give you|get you|pop|grab|try|trying|take|taking|have|having|use|using)\b[^.!?\n;:]{0,20}$/i;

/** The spans of a sentence's clauses, split at CLAUSE_BREAK_RE. */
function clauseSpans(sentence: string): [number, number][] {
  const cuts = [0];
  for (const m of sentence.matchAll(CLAUSE_BREAK_RE)) {
    const i = m.index ?? 0;
    if (i > cuts[cuts.length - 1]) cuts.push(i);
  }
  cuts.push(sentence.length);
  const out: [number, number][] = [];
  for (let k = 0; k < cuts.length - 1; k++) out.push([cuts[k], cuts[k + 1]]);
  return out;
}

/**
 * A clause that carries on a hand-over through a pronoun: "... to our clinical team, so they will contact you about the
 * dizziness", "... and one of them will call you". A clause that tells the patient to take or stop something does not.
 */
const HANDOVER_CONTINUES_RE =
  /^\W*(?:(?:and|so|then|who|where)\s+)?(?:they|he|she|one of (?:them|us)|someone|somebody|who)\b(?:(?!\b(?:take|use|try|have|drink|stop|skip|double|halve|mix)\b)[^.!?\n])*?\b(?:call|ring|phone|contact|be in touch|get in touch|reply|respond|get back|follow up|talk|speak|go through|check|review|look at|look into|discuss)\b/i;

/** The clauses of a sentence that hand over to a clinician or an emergency service. */
function handoverClauses(sentence: string): [number, number][] {
  const out: [number, number][] = [];
  let previous = false;
  for (const [a, b] of clauseSpans(sentence)) {
    const c = sentence.slice(a, b);
    // A cut between ", " and "so they" leaves only punctuation: it carries the hand-over on.
    if (!/[\p{L}\p{N}]/u.test(c)) {
      if (previous) out.push([a, b]);
      continue;
    }
    const isHandover: boolean = HANDOVER_RE.test(c) || EMERGENCY_RE.test(c) || (previous && HANDOVER_CONTINUES_RE.test(c));
    if (isHandover) out.push([a, b]);
    previous = isHandover;
  }
  return out;
}

/** Excuses a match only when it sits inside a hand-over clause. */
type Excuse = (start: number, end: number) => boolean;
const NO_EXCUSE: Excuse = () => false;

/** Every match of a regex, as [text, start, end]. */
function allMatches(re: RegExp, text: string): [string, number, number][] {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const out: [string, number, number][] = [];
  for (const m of text.matchAll(g)) {
    if (m.index === undefined || m[0].length === 0) continue;
    out.push([m[0], m.index, m.index + m[0].length]);
  }
  return out;
}

/** The first match of a regex that no hand-over excuses. */
function firstUnexcused(re: RegExp, text: string, excused: Excuse): string | undefined {
  return allMatches(re, text).find(([, s, e]) => !excused(s, e))?.[0];
}
/** Hits that are about billing or the app, not the medicine ("charged double the amount", "keep using the app"). */
const BILLING_RE = /\b(?:charg\w*|refund\w*|bill\w*|payments?|paid|pay|price\w*|invoices?|fees?|subscription|account)\b/i;
// Up to two words may sit before the app word: "keep using the same login", "stop using the old tracking link".
const NOT_MEDICINE_AFTER = new RegExp(
  String.raw`^\s*(?:(?:the|your|our|this|that|a|an|another|different)\s+)?${SUPPORT_GAP}${TECH_NOUN}\b`,
  "i",
);
const CLINICAL_CATEGORIES = new Set(["side_effect", "clinical_question"]);
/** Driving, which the patient lexicon only catches as a question ("can I drive"), not as a statement ("driving is okay"). */
const DRIVING_RE =
  /\b(?:drive|drives|driving|drove|driven|behind the wheel|machinery|forklifts?|heavy (?:machinery|equipment|vehicles?)|power tools|chainsaws?|cranes?|operat(?:e|es|ing) (?:a |the |any |your |heavy )?(?:\w+ )?(?:machinery|machines?|forklifts?|equipment|vehicles?|cars?|cranes?|tools|trucks?|excavators?|diggers?|tractors?|plant))\b/i;
/** A delivery driver or a street name ("14 Banksia Drive"), not the patient driving. */
const NOT_PATIENT_DRIVING_RE = /\b(?:courier\w*|drivers?|parcel|delivery|deliveries|van|postie)\b|\b[A-Z][a-z]+ Drive\b/;
/** Coming off the medicine ("stopping suddenly is fine"), but not stopping emails, orders or a plan. */
const STOPPING_RE =
  /\b(?:stopping|coming off|quitting|tapering|weaning|cold turkey)\b(?!\s+(?:the |your |any |all |these |those )?(?:e-?mails?|texts?|reminders?|messages?|deliver\w*|orders?|payments?|plan|subscription|marketing|notifications?|charges?|account)\b)/i;
/** Wrong or damaged item context, where policy asks the patient not to use it. */
const WRONG_ITEM_RE = /\b(?:wrong|damaged|leak\w*|broken|faulty|incorrect|recall\w*|right item|pharmacist)\b/i;
/** Policy words for the class of medicine, not another medicine ("prescription medicines need a signature"). */
const GENERIC_MEDICINE_RE = /^prescription\s+(?:medicines?|medications?|meds)$/i;

/** Instructions to change or time the medicine that need no lexicon word ("hold off on the oil", "take one before bed"). */
const MED_OBJECT_EXT = String.raw`(?:(?:it|them)\b(?!\s+(?:from|charging|sending|arriving|going|being|coming|shipping|personally|up|out)\b)|(?:(?:the|your|this|that|tonight['’]?s|today['’]?s|tomorrow['’]?s|this evening['’]?s|the next|your next|a|one|any|another)\s+)?${MED_WORD}\b)`;
const INSTRUCTION_RULES: RegExp[] = [
  // Stopping, skipping or pausing: "skip tonight's dose", "hold off on the capsules", "have a break from the oil",
  // "stop the capsules for now", "don't take it tonight", "pause the treatment for two days".
  new RegExp(
    String.raw`\b(?:skip|skipping|miss|missing|stop|stopping|pause|pausing|halt|drop|cut out|leave off|go without|come off|avoid|hold off(?:\s+(?:on|with))?|(?:have|take|having|taking)\s+a\s+(?:short\s+|little\s+|few days['’]?\s+)?(?:break|rest|pause|holiday)\s+(?:from|off)|give\s+(?:it|them|the\s+\w+|your\s+\w+)\s+a\s+(?:break|rest|miss)|(?:don['’]?t|do not|dont|no need to)\s+(?:take|use|have))\s+${MED_OBJECT_EXT}`,
    "gi",
  ),
  // When to take it: "take one before bed", "take it earlier in the evening", "try it in the morning instead". Not
  // where the parcel goes: "you can have it delivered to your sister's address instead" (MSG-0109).
  new RegExp(
    String.raw`\b(?:take|use|try|have|having|taking|using)\s+(?:it|them|one|two|another(?:\s+one)?|an extra(?:\s+one)?|one more|${MED_OBJECT_EXT})(?!\s+(?:to|back|in to|into|out|along|down|of|with you|a look|delivered|sent|posted|shipped|redirected|dispatched|forwarded|collected)\b)[^.!?\n]{0,40}?\b(?:before (?:you (?:go to (?:bed|sleep)|sleep|eat)|going to (?:bed|sleep)|sleep|food|meals?)|after (?:food|eating|dinner|meals?|breakfast|lunch)|first thing|last thing at night|before bed|at bedtime|bedtime|at night|tonight|in the (?:morning|evening|afternoon)|(?:each|every) (?:day|night|morning|evening)|daily|earlier|later in the|twice|once a|with (?:food|a meal|dinner|breakfast|lunch)|on an empty stomach|if you need (?:it|them|one|to)|when you need|as needed|instead)\b`,
    "gi",
  ),
  // Another dose: "take another one", "have an extra dose", "one more capsule".
  new RegExp(
    String.raw`\b(?:take|have|use|try)\s+(?:another|an extra|one more|a second|a double)\s+(?:one|dose|${MED_WORD})\b|\bdouble up\b`,
    "gi",
  ),
  // Telling the patient they need no clinician: "you don't need to see a doctor about this".
  /\b(?:don['’]?t|do not|dont|won['’]?t|will not|shouldn['’]?t|should not|no)\s+(?:need|have)\s+to\s+(?:see|call|contact|speak (?:to|with)|talk (?:to|with)|ring|check with|bother)\s+(?:a |an |your |the |our )?(?:doctor|GP|clinician|nurse|pharmacist|prescriber|clinical team|medical team)\b|\bno need (?:to (?:see|call|contact|speak to|talk to|ring) |for )(?:a |an |your |the )?(?:doctor|GP|clinician|nurse|pharmacist|prescriber)\b|\b(?:doctor|GP|clinician|pharmacist|prescriber)s?\s+(?:doesn['’]?t|does not|don['’]?t|do not|won['’]?t|will not)\s+need\s+to\s+(?:know|hear|be told)\b|\b(?:don['’]?t|do not|no need to)\s+(?:need to\s+)?tell\s+(?:your|the)\s+(?:doctor|GP|clinician|pharmacist|prescriber)\b/gi,
  // Carrying on with the medicine: "stick with it for a couple more weeks", "persevere with the capsules".
  new RegExp(
    String.raw`\b(?:stick|sticking|persevere|persevering|persist|persisting|hang in there|stay the course|keep going|keep at|carry on|push on|soldier on)\s+(?:with|at)\s+${MED_OBJECT_EXT}(?![^.!?\n]{0,40}\b(?:app|link|browser|login|password|tracking|form|page|site|website)\b)`,
    "gi",
  ),
  // Triage in other words: "seeing a GP isn't necessary", "you can skip the doctor", "no point bothering the clinician".
  new RegExp(
    [
      String.raw`\b(?:seeing|calling|contacting|ringing|visiting|speaking to|talking to|checking with|bothering|going to)\s+(?:a |an |your |the |our )?(?:doctor|GP|clinician|nurse|pharmacist|prescriber|clinical team|medical team|hospital|ED|A&E)\s+(?:isn['’]?t|is not|won['’]?t be|will not be|wouldn['’]?t be|would not be|shouldn['’]?t be|really isn['’]?t|probably isn['’]?t)\s+(?:really |strictly |actually |even |that )?(?:necessary|needed|required|essential|worth it|worth your time|a must|called for|urgent)\b`,
      String.raw`\b(?:skip|skipping|forget|forget about|avoid|bypass|put off|hold off on|don['’]?t bother with|do not bother with)\s+(?:the|a|your|an)\s+(?:doctor|GP|clinician|nurse|pharmacist|prescriber|check[- ]?up)\b|\b(?:skip|skipping|forget about|don['’]?t bother with|do not bother with)\s+(?:the|a|your|an)\s+(?:appointment|appt|consult\w*|follow[- ]?up)\b(?!\s+(?:reminders?|e-?mails?|texts?|notifications?|booking (?:page|link)|confirmations?|fee|fees|charge|charges|invoice)\b)`,
      String.raw`\bno (?:point|need|reason|sense) (?:in )?(?:bothering|calling|seeing|contacting|telling|ringing|asking|troubling|involving|to bother|to trouble|to involve)\s+(?:the|a|your|our|an)\s+(?:clinician|doctor|GP|nurse|pharmacist|prescriber|clinical team|medical team)\b`,
    ].join("|"),
    "gi",
  ),
  // Sharing the medicine: "it's okay to give it to your husband", "share some with a friend".
  /\b(?:give|giving|share|sharing|lend|lending|pass|passing)\s+(?:it|them|some|a bit|any|a few|one|a couple|(?:your|the)\s+(?:oil|capsules?|spray|drops|gummies|medicine|medication|meds))\s+(?:to|with)\s+(?:your|a|his|her|their|someone|somebody|anyone|another)\b(?!\s+(?:courier|driver|neighbou?r(?:'s)? (?:letterbox|house)|pharmacy|post office))/gi,
];

/** Claims about what the product does ("it really helps with sleep", "cannabis is completely safe"). */
const CLAIM_SUBJECT_RE = new RegExp(String.raw`\b(?:it|they|this|${MED_WORD})\b`, "i");
const CLAIM_VERB_RE =
  /\b(?:helps?|helped|helping|works?|worked|working|effective|effectively|eases?|eased|easing|cures?|cured|curing|relieves?|relieved|relief|great for|good for|brilliant for|ideal for|perfect for|fixe[sd]|treats?|treated|improves?|improved|reduces?|reduced|calms?|soothes?|better|best|relax(?:es|ed)|melts?|melted|loosens?|loosened|do(?:es)? (?:really |very |so |pretty |incredibly )?well)\b|\bkeeps? (?:\w+ ){1,3}(?:in check|at bay|away)\b/i;
const CONDITION_RE =
  /\b(?:pain|pains|painful|aches?|aching|anxiety|anxious|stress|stressed|sleep|sleeping|insomnia|arthritis|nausea|depression|mood|PTSD|epilepsy|seizures?|migraines?|headaches?|inflammation|appetite|symptoms?|endometriosis|fibromyalgia|spasms?|cramps?|tension|relax\w*|nerves|joints?|chronic|flare[- ]?ups?|flares?|endo|breakthrough|back pain|switch off|wind down|unwind|sleep(?:ing)? through|sleepless\w*|grief|griev\w*|wak(?:e|ing) up|restless\w*|tossing and turning|stiff\w*|blood pressure|BP|cholesterol|heart health|immune\w*|immunity|circulation|blood sugar|diabetes|cancer|wellbeing|well-being|libido|(?:nod|nodding|drift|drifting|doze|dozing) off|fall(?:s|ing)? asleep|get(?:ting)? (?:off )?to sleep)\b/i;
/** Other patients as the proof of an outcome: "most people sleep through the night", "many patients feel less pain". */
const POPULATION = String.raw`\b(?:most|many|lots of|plenty of|loads of|heaps of|a lot of|so many|the majority of|nearly all|almost all|thousands of|hundreds of|plenty|a fair few)\s+(?:of\s+)?(?:our\s+|the\s+|new\s+)?(?:people|patients|customers|users|folks|Australians|Kiwis|New Zealanders|Brits|women|men)\b`;
const OUTCOME_WORDS = String.raw`\b(?:better|through the night|less|fewer|easier|results?|relief|improv\w*|sleep(?:s|ing)? (?:well|soundly|properly)|calmer|back to (?:normal|their old selves)|pain[- ]free|off (?:their|the) other|do(?:es)? (?:really |very |so |pretty |incredibly )?well)\b`;
const POPULATION_OUTCOME_RE = new RegExp(String.raw`${POPULATION}[^.!?\n]{0,50}${OUTCOME_WORDS}|${OUTCOME_WORDS}[^.!?\n]{0,30}${POPULATION}`, "i");
/** A results promise: "people with arthritis tend to get great results". */
const RESULTS_RE = /\b(?:great|good|amazing|excellent|real|fantastic|brilliant|positive|strong|life[- ]changing|incredible|best|fast|quick)\s+results?\b/i;
const CLAIM_RULES: RegExp[] = [
  // "you'll feel much better once you start the capsules"
  new RegExp(String.raw`\bfeel\s+(?:(?:much|a lot|so much|loads|heaps|far|way|a bit)\s+)?better\b[^.!?\n]{0,50}?\b${MED_WORD}\b|\b${MED_WORD}\b[^.!?\n]{0,50}?\bfeel\s+(?:(?:much|a lot|so much|loads|heaps|far|way|a bit)\s+)?better\b`, "gi"),
  // "cannabis is completely safe", "it is totally harmless"
  new RegExp(
    String.raw`\b${MED_WORD}\s+(?:is|are|['’]s)\s+(?:(?:completely|totally|perfectly|very|entirely|really|quite|100%|absolutely)\s+)?(?:safe|harmless|risk[- ]free|non[- ]addictive|natural)\b|\b(?:it|they)\s+(?:is|are|['’]s|['’]re)\s+(?:completely|totally|perfectly|entirely|absolutely|100%)\s+(?:safe|harmless|risk[- ]free|non[- ]addictive)\b`,
    "gi",
  ),
  // "give it a couple of weeks and it should start working", "the capsules should kick in within the week", "the oil
  // takes effect within an hour". A product word that only names an order, a price or a plan swap ("the oil price",
  // "the product swap takes effect from your next order") is not a subject.
  new RegExp(
    String.raw`\b(?:it|they|them|${MED_WORD})\b(?!\s+(?:orders?|parcels?|packages?|deliver(?:y|ies)|shipments?|prices?|pricing|charges?|fees?|codes?|discounts?|subscriptions?|swaps?|swapped|switch(?:es|ed)?)\b)[^.!?\n]{0,60}?\b(?:start(?:s)? (?:to )?work(?:ing)?|kicks? in|takes? effect|begins? to work|work for you|do the trick|make a (?:real |big )?difference)\b`,
    "gi",
  ),
];
/** "It should start working" about a link or a card is not about the medicine. */
const TECH_RE = /\b(?:app|link|password|log ?in|account|website|site|page|card|payment|code|portal|browser|email|update|reset|refresh|tracking|courier|parcel|order)\b/i;
/**
 * "The date it takes effect" about a price change, a charge or a notice is not about the medicine either. Stricter than
 * TECH_RE: no medicine word, no symptom or condition word, and no waiting period set for "it" ("give it two weeks").
 */
const MONEY_NOTICE_RE =
  /\b(?:prices?|pricing|priced|billing|billed|bills?|charges?|charged|fees?|notices?|dates?|invoices?|subscriptions?|refunds?|concessions?|discounts?)\b/i;
const WAIT_FOR_IT_RE =
  /\bgive (?:it|them)\b|\b(?:after|within|in|over|for) (?:a few|a couple(?: of)?|the first|\d+|one|two|three|four|a) (?:days?|weeks?|months?|nights?|doses?)\b/i;
/**
 * True when a "starts working" / "takes effect" match in this sentence is about an app, a card, a price or a notice.
 * With an app or parcel word, any medicine word keeps it blocked ("once your oil order arrives, give it two weeks and it
 * kicks in"). With a price or notice word, a product word that only names a price is allowed ("the oil price rises on
 * 1 October, the date it takes effect"), but a waiting period, a symptom or a condition is not.
 */
function effectIsNotMedicine(t: string): boolean {
  if (TECH_RE.test(t)) return !MED_WORD_RE.test(t);
  return (
    MONEY_NOTICE_RE.test(t) &&
    !namesMedicine(t) &&
    !WAIT_FOR_IT_RE.test(t) &&
    !SYMPTOM_WIDE_RE.test(t) &&
    !SERIOUS_WIDE_RE.test(t) &&
    !CONDITION_RE.test(t)
  );
}

// ---------- the edit-path clinical gate, by category ----------
//
// An agent editing a reply can word clinical content any way, so the gate works in categories, each with a plain
// label the agent reads next to Send ("Never allowed in a reply: plays down a symptom: ..."). Tuned to over-block: a
// false stop costs one rewrite or an escalation, a miss sends clinical content to a patient. tests/check.test.ts
// holds the phrasings each category must block and the ordinary support sentences that must still pass.

/** Everyday idioms that use symptom words ("sorry this has been such a headache", "no sweat"). Blanked out first. */
const IDIOM_RE =
  /\b(?:such a|a real|a bit of a|what a|a total|a massive|a big|a right|a huge|an absolute) (?:headache|pain|nightmare)\b|\b(?:a pain|no sweat|burning question|pain in the neck|nightmare to|headache to)\b|\bbeen (?:a|quite a|a bit of a) (?:headache|nightmare|pain)\b(?!\s+(?:for|since|every|each|at|in|when|after|and|with|on|or|that|which|all)\b)|\bheadache (?:sorting|dealing|to sort|to deal)\b/gi;
function withoutIdioms(s: string): string {
  return s.replace(IDIOM_RE, (m) => " ".repeat(m.length));
}

/**
 * Symptom words beyond the patient lexicon, for spotting a symptom that is being played down. Includes everyday
 * wording ("pale poo", "going off your food", "a bitten tongue", "fingertips fizzing", "that sort of feeling").
 */
const SYMPTOM_WIDE_RE = new RegExp(
  String.raw`\b(?:${SYMPTOM}|pains?|aches?|aching|sore(?:ness)?|breathless\w*|short(?:ness)? of breath|palpitations?|hives|swollen|bleeding|bruis\w*|cough\w*|fevers?|numb\w*|tingl\w*|cramps?|twitch\w*|paranoi\w*|hallucinat\w*|seizures?|fainting|blackouts?|confus\w*|panic attacks?|nightmares?|insomnia|withdrawals?|cravings?` +
    String.raw`|poos?|stools?|bowels?|urine|jaundice|yellow(?:ing)?|pale|appetite|off (?:your|his|her|their) food|going off (?:your |his |her |their )?food|not eating|tongue|mouth|lips?|fingertips|fingers|toes|fuzz\w*|fizz\w*|pins and needles|spaced[- ]out|out of it|wobbly|jittery|tired|tiredness|exhausted|exhaustion|sleepy|chest|breath|breathing|heart|forgetful\w*|blurr\w*|sweat\w*|chills|shiver\w*|vomit\w*|sick|diarrh\w*|constipat\w*|bloat\w*|irritab\w*|restless\w*|agitat\w*|jerk\w*|bitten|mood|(?:sort|kind) of feeling|feeling in (?:your|the|his|her)|(?:fuzzy|funny|strange|weird|odd|tingly|heavy|floaty|buzzy|sick|queasy|off|spaced[- ]out|low|flat) feeling|[\w-]+(?:y|ish|ed) feelings?` +
    String.raw`|low energy|no energy|lack of energy|fatigue\w*|letharg\w*|sluggish\w*|foggy|brain fog|stiff\w*|shakes|shaky|shaki\w*|trembl\w*|tremor\w*|jitters|spacey|spacy|zonked|wiped out|night sweats|hot flush\w*|hot flash\w*)\b`,
  "i",
);

/** Words that wave a symptom away: "don't worry", "probably nothing", "that's normal", "it will pass", "just ignore". */
const DISMISS_RE = new RegExp(
  [
    String.raw`\b(?:don['’]?t|do not|dont|no need to|try not to) (?:worry|stress|panic|be (?:worried|concerned|alarmed))\b`,
    String.raw`\bnothing (?:to worry about|serious|major|bad|dangerous|much|to be (?:worried|concerned) about)\b`,
    String.raw`\bnot (?:anything )?(?:serious|dangerous|harmful|a (?:big )?(?:concern|problem|worry|issue|deal)|worth worrying about|something to worry about)\b`,
    String.raw`\bno (?:big deal|cause for (?:concern|alarm)|need for concern)\b`,
    String.raw`\b(?:probably|likely|most likely|very likely|almost certainly|surely|I['’]?m sure (?:it['’]?s|that['’]?s)|I (?:think|reckon|suspect) (?:it['’]?s|that['’]?s))\s+(?:just\s+|only\s+|simply\s+)?(?:nothing|fine|normal|ok|okay|harmless|nerves|anxiety|stress|muscular|a (?:muscle|pulled muscle|strain|phase|reaction|side effect|virus|cold|bug)|indigestion|heartburn|wind|in your head|tiredness|tired|dehydration|the heat|hormonal|hormones|age)\b|\b(?:probably|likely|most likely) (?:just|only|simply)\b`,
    String.raw`\bjust (?:anxiety|stress|nerves|in your head|a phase|your body (?:adjusting|getting used)|getting used to (?:it|them)|a (?:bit|little) of)\b|\b(?:just|simply|only|merely) (?:your|the) (?:body|system|brain|mind)\b`,
    String.raw`\b(?:is|are|it['’]?s|that['’]?s|they['’]?re|sounds|seems|looks|feels?) (?:quite |very |completely |perfectly |pretty |totally |usually |often |just |all |fairly |really )?(?:normal|common|expected|harmless|fine|ok|okay|nothing|typical|mild|minor|temporary|natural)\b`,
    // "a known and mild effect", "a recognised effect", "one of the most frequent reactions", "part of the process".
    String.raw`\b(?:is|are|it['’]?s|that['’]?s|they['’]?re|sounds|seems|was|were) (?:(?:a|an|just a|only a|usually a|often a|really a|quite a|such a)\s+)?(?:(?:very|quite|really|pretty|fairly|totally|completely|perfectly|usually|often|generally|well|small|little)\s+)?[\w-]+ (?:and|but) (?:(?:very|quite|really|pretty|fairly|usually|often|generally)\s+)?(?:normal|common|expected|harmless|typical|mild|minor|temporary|natural|short[- ]lived|benign)\b`,
    String.raw`\bnormal (?:at first|to begin with|in the first|early on|for (?:the first|a (?:few|while)))`,
    String.raw`\b(?:will|should|would|usually|often|always|normally|generally|typically|mostly|tends? to|it['’]?ll|they['’]?ll|['’]ll) (?:just |soon |quickly |probably |likely |all )?(?:pass|settle(?: down)?|go away|wear off|ease(?: off)?|clear(?: up)?|improve|stop|calm down|sort itself out|fade|fade away|disappear|lift|vanish|be gone|be over|be a thing of the past|die off)\b`,
    // Bare present verbs after an adverb: "it always settles", "anxiety usually lifts", "it generally fades".
    String.raw`\b(?:usually|often|always|normally|generally|typically|mostly|soon|quickly|eventually|gradually) (?:just )?(?:passes|settles(?: down)?|goes away|wears off|eases(?: off)?|clears(?: up)?|improves|calms down|sorts itself out|fades(?: away)?|disappears|lifts|vanishes|subsides|resolves|dies down)\b`,
    String.raw`\b(?:pass|passes|go away|goes away|wear off|wears off|settle|settles|settle down|settles down|clear up|clears up|fade|fades|fade away|fades away|lift|lifts|ease|eases|ease off|eases off|disappear|disappears|subside|subsides|resolve|resolves|vanish|vanishes) (?:on (?:its|their) own|by (?:it|them)sel(?:f|ves)|soon|quickly|fast|rapidly|in (?:a|no) time|after a (?:while|bit|few|little while|couple)|within (?:a|the first|a few|days|hours))`,
    String.raw`\b(?:wouldn['’]?t|would not|don['’]?t|do not|no need to|not|try not to|shouldn['’]?t|should not|never)\s+(?:\w+\s+)?read (?:too much |anything |much |a lot )?into\b|\b(?:doesn['’]?t|does not|won['’]?t|don['’]?t|do not|probably doesn['’]?t) (?:really |necessarily )?mean (?:anything|much|a thing)\b|\b(?:you['’]?ll|you will|you['’]?re going to|he['’]?ll|she['’]?ll|they['’]?ll) (?:soon |quickly |easily )?bounce back\b|\bbounce back (?:soon|quickly|in no time|before you know it)\b`,
    String.raw`\bignor(?:e|ing)\b|\bpush (?:through|on)\b|\bride (?:it|them|this) out\b|\btough it out\b|\bsleep it off\b|\bwait (?:it out|and see)\b`,
    String.raw`\bcan['’]?t be (?:serious|bad|dangerous)\b|\bnothing wrong\b|\byou['’]?(?:ll| will) be (?:fine|ok|okay|alright|all right)\b|\byou['’]?re (?:fine|ok|okay|alright|all right)\b`,
    // "usually sort themselves out", "should go down soon", "tends to die down", "will get better on its own".
    String.raw`\bsort(?:s|ed)? (?:it|itself|them|themselves|yourself) out\b|\b(?:settle|settles|resolve|resolves) (?:itself|themselves|on (?:its|their) own)\b|\b(?:will|should|would|usually|often|normally|generally|typically|tends? to|it['’]?ll|they['’]?ll|['’]ll)(?: (?:just|soon|quickly|probably|likely))? (?:go down|die down|subside|calm|get better|resolve|ease up|lessen|fade away|clear)\b|\b(?:goes|go|went|die|dies) down (?:on (?:its|their) own|soon|quickly|by (?:it|them)sel(?:f|ves)|after a (?:while|bit|few))`,
    // "I wouldn't be too concerned", "I wouldn't worry", "not too worrying", "no real reason to worry".
    String.raw`\b(?:wouldn['’]?t|would not|wouldnt|shouldn['’]?t|should not|needn['’]?t|need not) (?:(?:be|get|feel) )?(?:too |overly |very |that |so |at all |unduly )?(?:concerned|worried|alarmed|bothered|fussed|stressed|anxious|worry|stress|panic|fret)\b|\bnot (?:too |overly |that |very |really )?(?:concerning|worrying|alarming)\b|\bno (?:real )?(?:need|reason) (?:to|for) (?:worry|be (?:worried|concerned)|concern|alarm)\b`,
    // "can happen", "nothing unusual", "totally standard", "par for the course", "to be expected".
    String.raw`\bcan (?:happen|occur)\b|\bhappens? (?:sometimes|a lot|to (?:lots|loads|plenty|most|many|everyone))\b|\bnothing (?:unusual|out of the ordinary|abnormal|strange|odd|new)\b|\bnot (?:unusual|uncommon|abnormal)\b|\b(?:is|are|it['’]?s|that['’]?s|sounds|seems) (?:quite |very |completely |perfectly |pretty |totally |fairly |really )?(?:standard|usual|par for the course|to be expected)\b|\bpar for the course\b`,
    // "just the oil settling in", "your body adjusting", "sleep it off", "you'll come right", "a cold coming on".
    // "Keep an eye on" is checked on its own (KEEP_EYE_RE), so it can be excused when it is only about a parcel.
    String.raw`\bsettl(?:e|es|ing) in\b|\bbedding in\b|\bjust (?:the|your) (?:oil|capsules?|spray|medicine|meds|treatment|product|dose|drops|body)\b|\bsleep(?:s|ing)? (?:it|this|that|them|the \w+) off\b|\bsleep off\b|\byou['’]?ll (?:come right|be sweet|be right|be grand|be good as gold|be sweet as)\b|\b(?:should|will|['’]ll|would) be (?:right|sweet|grand)\b`,
    String.raw`\bjust (?:a (?:bit|little|touch|wee bit) )?(?:tired|run down|under the weather|off|flat|low|confused|forgetful|out of sorts|a cold|a bug|a virus|tiredness|hormones|age|getting older|dehydrat\w*|overtired)\b|\ba (?:cold|bug|virus) coming on\b|\bcoming down with\b|\bsort(?:s|ed)? (?:\w+ ){1,5}out\b|\byou['’]?ll feel (?:better|fine|ok|okay|yourself|right) (?:after|once|when|with|in|soon)\b`,
  ].join("|"),
  "i",
);

/**
 * "Keep an eye on it": watch-and-wait advice, which plays a symptom down ("pale poo can happen, just keep an eye on
 * it"). Excused only in a sentence that is plainly about a parcel ("keep an eye on it with tracking number ...") and
 * names no symptom, no medicine and no clinical word (keepEyeOnParcel).
 */
const KEEP_EYE_RE = /\bkeep an eye on\b/i;
const PARCEL_WORD_RE =
  /\b(?:parcels?|packages?|tracking|tracked|track it|orders?|deliver(?:y|ies|ed)?|courier\w*|Courierline|shipments?|shipped|dispatch\w*|redirect\w*|depot|postie|in the post)\b/i;

/**
 * True when "keep an eye on" in this sentence is about a parcel: a parcel word, and no medicine word, symptom word or
 * clinical lexicon hit. "Number" is blanked first, because the symptom list reads "numb..." and a tracking number is
 * not numbness.
 */
/** How the patient feels or reacts: "keep an eye on how you feel", "how your body reacts", "any effects". */
const KEEP_EYE_EFFECT_RE = /\b(?:feel\w*|makes? you|affect\w*|react\w*|respond\w*|effects?|body|mood|sleep\w*|symptoms?)\b/i;
function keepEyeOnParcel(plain: string, hits: RuleHit[]): boolean {
  if (!PARCEL_WORD_RE.test(plain) || MED_WORD_RE.test(plain) || KEEP_EYE_EFFECT_RE.test(plain)) return false;
  const noNumbers = plain.replace(/\bnumbers?\b/gi, (m) => " ".repeat(m.length));
  if (SYMPTOM_WIDE_RE.test(noNumbers) || SERIOUS_WIDE_RE.test(noNumbers)) return false;
  return !hits.some((h) => h.category !== "stop_sending");
}

/**
 * A product word that only names an order or a price ("your oil order", "the capsules parcel", "the oil price") is
 * taken out before testing. Dose and treatment words are never taken out ("your dose change" is clinical).
 */
const MED_ORDER_PHRASE_RE = new RegExp(
  String.raw`\b(?:oils?|capsules?|caps|sprays?|drops|gumm(?:y|ies)|tinctures?|flower|medicines?|medications?|meds|products?|blends?|vapes?|cartridges?|cannabis|CBD|THC)\s+(?:orders?|parcels?|packages?|deliver(?:y|ies)|shipments?|repeats?|refills?|prices?|pricing|charges?|fees?)\b`,
  "gi",
);
function namesMedicine(text: string): boolean {
  return MED_WORD_RE.test(text.replace(MED_ORDER_PHRASE_RE, (m) => " ".repeat(m.length)));
}

/**
 * "If you miss it, Courierline holds the parcel at the local depot": "it" is the delivery, not a dose. Excused only for
 * "miss it" / "miss them" with a bare pronoun, in a sentence that names a parcel, a delivery, the courier, a depot, a
 * redelivery or a card, and names no medicine, dose, symptom or timing word; the sentence before names no medicine
 * either. "If you miss it tonight, take it in the morning" and "skip the capsules" stay blocked.
 */
const MISS_PRONOUN_RE = /^(?:miss|missing)\s+(?:it|them)$/i;
const MISSED_PARCEL_RE =
  /\b(?:parcels?|packages?|deliver(?:y|ies|ed)?|redeliver(?:y|ies|ed)?|courier\w*|Courierline|depot|cards?|signature|sign for|tracking|shipments?|postie|in the post)\b/i;
const MISSED_DOSE_CUE_RE =
  /\b(?:take|taking|took|double|remember\w*|tonight|morning|evening|afternoon|bed(?:time)?|at night|daily|dose\w*|feel\w*|symptoms?|next one|catch up|make up)\b/i;
function missIsDelivery(previous: string, sentence: string, matched: string): boolean {
  if (!MISS_PRONOUN_RE.test(matched.trim())) return false;
  if (!MISSED_PARCEL_RE.test(sentence) || MED_WORD_RE.test(sentence) || MISSED_DOSE_CUE_RE.test(sentence)) return false;
  if (SYMPTOM_WIDE_RE.test(sentence) || SERIOUS_WIDE_RE.test(sentence) || CLINICAL_TOPIC_RE.test(sentence) || OTHER_MEDICINE_RE.test(sentence)) {
    return false;
  }
  return !namesMedicine(previous);
}

/**
 * "Pause it", "stop it" where "it" is the patient's plan: the nearest thing named before it, in this sentence or the
 * one before, is the plan ("... cancel your plan. If you'd rather pause it for 1 to 3 months instead ..."). Never when
 * a medicine word is named in either sentence, or a symptom in this one ("pause it if you feel sick"): then it stays
 * blocked as advice to stop the medicine.
 */
const PLAN_NOUN_RE = /\b(?:plan|subscription|membership)\b/gi;
function pronounIsPlan(previous: string, sentence: string, start: number, matched: string): boolean {
  if (!/\b(?:it|them)$/i.test(matched.trim())) return false;
  if (!/^(?:pause|pausing|stop|stopping|halt|skip|skipping)\b/i.test(matched.trim())) return false;
  if (MED_WORD_RE.test(previous) || MED_WORD_RE.test(sentence)) return false;
  if (SYMPTOM_WIDE_RE.test(sentence) || SERIOUS_WIDE_RE.test(sentence) || CLINICAL_TOPIC_RE.test(sentence) || OTHER_MEDICINE_RE.test(sentence)) {
    return false;
  }
  const before = `${previous} ${sentence.slice(0, start)}`;
  const plans = [...before.matchAll(PLAN_NOUN_RE)];
  if (plans.length === 0) return false;
  const last = plans[plans.length - 1];
  // Nothing else that "it" could be may come after the last plan word: an order, a parcel, a consult, a card.
  const after = before.slice((last.index ?? 0) + last[0].length);
  return !/\b(?:orders?|parcels?|deliver(?:y|ies)|consult\w*|appointments?|cards?|payments?|charges?|refunds?|prescriptions?|scripts?)\b/i.test(after);
}

/**
 * "We will pass your request to drop the capsules to a clinician": the patient's request handed to a clinician, not
 * an instruction to stop the medicine. The words before the match must be a hand-over verb and "your request to", and
 * the same clause must end at a clinician. The rest of the request may sit in between, up to six words joined to the
 * match by "and" ("pass your request to keep the oil and drop the capsules to a clinician", MSG-0041), but never a
 * pronoun, a time word, a clinician or punctuation: "we have passed your request to a clinician and you can drop the
 * capsules" still blocks.
 */
const REQUEST_GAP = String.raw`(?:(?:(?!(?:you|we|they|I|he|she|then|now|until|meanwhile|today|tonight|clinicians?|doctors?|GPs?|nurses?|prescribers?|pharmacists?|clinical|medical)\b)[\w'’-]+\s+){1,6}?and\s+)?`;
const REQUEST_BEFORE_RE = new RegExp(
  String.raw`\b(?:pass|passed|passing|send|sent|sending|forward(?:ed|ing)?|refer(?:red|ring)?|hand(?:ed|ing)?(?:\s+on)?|raise[ds]?|raising|share[ds]?|sharing|put|putting)\s+(?:on\s+)?(?:your|the|this|that)\s+request\s+to\s+${REQUEST_GAP}$`,
  "i",
);
const REQUEST_TO_CLINICIAN_RE =
  /^[^.!?\n;:,]{0,40}?\s(?:on\s+)?to\s+(?:a|an|the|our|one of our|your)\s+(?:clinicians?|doctors?|prescribers?|clinical team|medical team|pharmacists?)\b/i;
function requestPassedToClinician(sentence: string, start: number, end: number): boolean {
  return REQUEST_BEFORE_RE.test(sentence.slice(Math.max(0, start - 100), start)) && REQUEST_TO_CLINICIAN_RE.test(sentence.slice(end));
}

/**
 * "The team will also reply about your separate request to drop the capsules from your plan" (MSG-0027): naming the
 * patient's own plan-change request, not advice. Only "drop" or "remove" X "from your plan", with a request noun
 * directly before it ("your (separate|earlier) request to"). "You can drop the capsules" and "drop the capsules for a
 * few days" still block.
 */
const REQUEST_NOUN_BEFORE_RE =
  /\b(?:your|the|this|that|a)\s+(?:(?:separate|earlier|other|previous|recent|second|new|original|own)\s+)?request\s+to\s+$/i;
const FROM_PLAN_AFTER_RE = /^\s+from\s+(?:your|the)\s+(?:(?:monthly\s+)?treatment\s+)?plan\b/i;
function requestToDropFromPlan(sentence: string, start: number, end: number): boolean {
  if (!/^(?:drop|dropping|remove|removing)\s/i.test(sentence.slice(start, end))) return false;
  return REQUEST_NOUN_BEFORE_RE.test(sentence.slice(Math.max(0, start - 60), start)) && FROM_PLAN_AFTER_RE.test(sentence.slice(end));
}

/**
 * Wording that makes a symptom sound ordinary rather than waving it away outright: "a known effect", "one of the most
 * frequent reactions", "part of the process", "lots of patients feel a bit dizzy", "a small price to pay". Checked
 * after the clinical-words gate, so a sentence that already reads as clinical advice keeps that label.
 */
const NORMALISE_RE = new RegExp(
  [
    String.raw`\b(?:known|recogni[sz]ed|documented|listed|frequent|common|usual|typical|well[- ]known|normal|expected|standard|mild|minor|temporary|harmless)(?: (?:and|but) [\w-]+)? (?:effects?|reactions?|side[- ]effects?|after[- ]effects?|symptoms?)\b`,
    String.raw`\bone of the (?:most )?(?:common|frequent|usual|typical|normal|expected|known|mildest|minor)(?:est)? (?:effects?|reactions?|side[- ]effects?|things|symptoms?|complaints?)\b`,
    String.raw`\bpart (?:and parcel )?of (?:the process|the deal|the journey|starting|getting used|getting started|the adjustment|adjusting|settling in|the first (?:few )?(?:days|weeks?))\b|\bcomes with the territory\b|\bnothing more than\b|\band nothing more\b|\bnothing else to it\b`,
    // A symptom made ordinary through other patients: "lots of patients feel a bit dizzy for the first week".
    String.raw`\b(?:lots of|many|most|plenty of|loads of|heaps of|a lot of|some|a few|so many|nearly all|almost all|the majority of|a fair few|plenty)\s+(?:of\s+)?(?:our\s+|new\s+)?(?:people|patients|customers|folks|users|women|men)\s+(?:[\w'’]+\s+){0,3}?(?:feel|feels|get|gets|notice|have|experience|report|find|go through|deal with|struggle with|start (?:with|off)|end up)\b`,
    String.raw`\b(?:the )?least of (?:your|his|her|their|our) worries\b|\ba small price(?: to pay)?\b|\bnot the end of the world\b|\bno biggie\b`,
  ].join("|"),
  "i",
);

/**
 * Wording that plays down how someone is, or gives self-care advice, even with no symptom named: "he should be right
 * once he sleeps it off", "sounds like you just need more water and a good lie down".
 */
const DISMISS_ALWAYS_RE =
  /\bsleep(?:s|ing)? (?:it|this|that|them) off\b|\byou['’]?ll come right\b|\b(?:just |only |really )?need(?:s)? (?:more |some |plenty of |a (?:good )?|an )(?:water|fluids|rest|sleep|lie[- ]down|early night|nap|cup of tea|fresh air|good sleep)\b|\b(?:have|get|try|take) (?:a (?:good |nice |long )?)?(?:lie[- ]down|early night|nap)\b|\b(?:drink|have|get|sip|keep up)\s+(?:lots of|plenty of|loads of|heaps of|more|some|extra|a (?:big |large )?glass of)\s+(?:water|fluids|electrolytes)\b|\bstay hydrated\b|\bright as rain\b|\ba good night['’]?s sleep (?:usually |should |will |normally |often )?(?:sorts?|fix(?:es)?|help(?:s)?|clears?)\b/i;

/**
 * Serious symptoms in everyday words that the patient lexicon may not know ("a tight chest", "a bitten tongue", "pale
 * poo"): only a clinician replies about them, unless the sentence only hands over.
 */
const SERIOUS_WIDE_RE =
  /\b(?:tight(?:ness)? (?:in |across )?(?:the |your |his |her |their )?chest|chest (?:pains?|tightness|is tight|feels tight)|can['’]?t (?:breathe|catch (?:your|his|her|their) breath)|short(?:ness)? of breath|breathless\w*|faint(?:ed|ing|s)?|pass(?:ed|es|ing)? out|black(?:ed|ing|s)? out|blackouts?|seizures?|convuls\w*|jerk(?:ing|s|ed)|bit(?:ten)? (?:his |her |their |your )?tongue|bitten tongue|jaundice|yellow(?:ing)? (?:skin|eyes)|pale (?:poos?|stools?)|dark (?:urine|wee|pee)|blood in|coughing (?:up )?blood|swollen (?:face|lips?|tongue|throat|eyes)|hallucinat\w*|paranoi\w*|seeing things|hearing voices|slurr\w*|stroke(?! of)|unresponsive|won['’]?t wake|not waking|floppy|palpitations?|heart (?:racing|pounding|fluttering|skipping)|racing heart|irregular heart ?beat)\b/i;

/** Crisis and low-mood language in an agent's own words ("everyone feels like giving up", "so much to live for"). */
const CRISIS_WORDS_RE = new RegExp(
  [
    String.raw`\b(?:feel(?:s|ing)?|felt) like giving up\b|\bgiv(?:e|es|ing) up on (?:life|everything|yourself|living)\b|\bwant(?:s|ed|ing)? to give up\b`,
    String.raw`\bend(?:s|ed|ing)? (?:things|it all|everything|(?:my|your|his|her|their) life)\b`,
    String.raw`\bno way out\b|\bno (?:point|reason) (?:in |to )?(?:living|going on|carrying on|being here)\b|\bnothing (?:left )?to live for\b|\b(?:so much|lots|plenty|everything|a lot) to live for\b|\breasons? to (?:live|keep going|stay alive)\b`,
    String.raw`\bhopeless(?:ness)?\b|\bworthless\b|\bhelpless(?:ness)?\b`,
    String.raw`\b(?:do|doing|did) (?:anything|something) (?:silly|stupid|daft|drastic|rash)\b`,
    String.raw`\ba burden\b|\bburden (?:to|on) (?:anyone|anybody|everyone|you|them|others|your|the)\b`,
    String.raw`\bnot coping\b|\b(?:can['’]?t|cannot|can not|couldn['’]?t|struggling to|hard to|unable to) cope\b`,
    String.raw`\blow (?:day|days|mood|moods|patch|spell|point|ebb)\b|\bdown in the dumps\b|\bdark (?:thoughts?|place|days?|times|spells?|patch(?:es)?|moods?)\b|\b(?:rough|bad|black) (?:patch(?:es)?|days?|spells?) (?:with (?:your|my|his|her|their) mood|mentally|emotionally)\b|\bin a (?:bad|dark) (?:place|way)\b`,
    String.raw`\bfeel(?:s|ing)? (?:a (?:bit|little|wee bit|tad) |so |really |pretty |quite |very |kind of |kinda |this |that |as |too )?(?:flat|down|low|numb|empty|hopeless|worthless|blue|miserable|teary|tearful|like crying)\b`,
    String.raw`\byou (?:don['’]?t|do not|didn['’]?t|did not) (?:really )?mean (?:that|it|what you (?:said|wrote))\b|\bhang in there\b|\byou(?:['’]ll| will| can|['’]re going to| are going to) get through (?:it|this)\b|\bbetter off without\b`,
    String.raw`\bsuicid\w*|\bself[- ]?harm\w*|\b(?:harm|hurt|kill)(?:ing)? (?:yourself|themselves|himself|herself)\b|\bwant(?:s|ing)? to die\b`,
  ].join("|"),
  "i",
);

/** Other medicines, supplements and interacting foods: naming them in a reply is clinical advice. */
const OTHER_MEDICINE_RE =
  /\b(?:paracetamol|acetaminophen|ibuprofen|panadol|nurofen|aspirin|codeine|antihistamines?|melatonin|St\.? John['’]?s wort|valerian|kava|grapefruit|supplements?|vitamins?|sleeping (?:pills|tablets)|pain ?killers?|antidepressants?|sedatives?|opioids?|tramadol|oxycodone|endone|gabapentin|pregabalin|lyrica|diazepam|valium|zopiclone|stilnox|claratyne|zyrtec|telfast|phenergan|gaviscon|imodium|buscopan|voltaren|panadeine|lemsip|natural remed(?:y|ies)|herbal remed(?:y|ies)|(?:other|pain|sleeping) (?:meds|medications?|medicines?|tablets|pills))\b/i;

/** Alcohol, pregnancy and breastfeeding words the patient lexicon may not know ("a few G&Ts", "milk you pump"). */
const CLINICAL_TOPIC_RE =
  /(?:\bG ?& ?Ts?\b|\bG and Ts?\b|\b(?:gins?|vodkas?|whisk(?:e)?ys?|rums?|tequilas?|beers?|wines?|pints?|cocktails?|booze|bevvies|bevvy|alcohol\w*|champagne|prosecco|ciders?|spirits(?! up)|a few (?:drinks|glasses|beers|wines)|a glass of \w+|caffeine|energy drinks?|coffees?(?!\s+(?:shop|shops|cart|table|machine|van|break))|espressos?)\b|\b(?:breast ?feed\w*|breast ?milk|express(?:ed|ing)? milk|milk (?:you|she|they) (?:pump|express)\w*|pump(?:ed|ing)? milk|pregnan\w*|trying for a baby|conceiv\w*|newborn|infant|(?:the|your|a|her) (?:baby|bub|unborn)|babies)\b|\bmilk\b[^.!?\n]{0,20}\bpump\w*)/i;

/** Referring a symptom to the patient's own doctor ("speak to your GP about the headaches"): a triage call for our clinician. */
const EXTERNAL_REFERRAL_RE =
  /\b(?:see|speak (?:to|with)|talk (?:to|with)|call|ring|contact|visit|check with|ask|book in with|pop in to|go to|(?:mention|raise|bring up|show)\b[^.!?\n]{0,30}?\b(?:to|with))\s+(?:your|a|their|his|her|the local|a local|your local|your own)\s+(?:own\s+)?(?:GP|doctor|local doctor|family doctor|pharmacist|chemist|physio)\b/i;

/** Things, not people, that can "collapse" or "fall" in a support reply ("the box collapsed in the hallway"). */
const THING_RE =
  /\b(?:box|boxes|parcel|package|packaging|carton|bottle|lid|shelf|shelves|site|website|app|system|server|page|tent|roof|ceiling|bag|envelope|letterbox|delivery|order)\b/i;

/** A verdict with nothing named ("That's normal.", "Nothing serious.", "It will pass."): about what the patient felt. */
const VERDICT_ONLY_RE =
  /\b(?:that['’]?s|it['’]?s|this is|that is|it is|they['’]?re|they are|that sounds|it sounds)\s+(?:quite |very |completely |perfectly |totally |pretty |really |all |just )?(?:normal|common|expected|harmless|nothing serious|nothing to worry about)\b|\bnothing (?:serious|to worry about)\b|\bno need to worry\b|\b(?:it['’]?ll|it will|that will|this will|they['’]?ll|they will) (?:pass|settle|go away|wear off)\b|\b(?:it|they|this|that)\s+(?:usually|always|normally|generally|often|mostly|typically)\s+(?:passes|pass|settles?|goes away|go away|wears? off|fades?|lifts?|eases?|clears? up|sorts? itself out|sort themselves out)\b|\bwe see (?:this|that|it) (?:a lot|all the time|often|quite often|regularly|every day|loads)\b/i;

/**
 * Patient-lexicon rules whose words are serious symptoms or crisis words whatever surrounds them. In an agent's reply
 * they always go to a clinician, unless the sentence only hands over ("a clinician will call you about the chest pain").
 */
const SERIOUS_RULES: ReadonlySet<string> = new Set([
  "crisis.suicide", "crisis.kill_myself", "crisis.method", "crisis.self_harm", "crisis.want_to_die",
  "crisis.overdose_on_purpose", "crisis.not_want_to_live", "crisis.no_reason_to_live",
  // Crisis thoughts and plans in any person: "thoughts of ending things", "wanting it all to be over".
  "crisis.dark_thoughts", "crisis.over", "crisis.plan_to_take", "crisis.hopeless", "crisis.not_here", "crisis.final_acts",
  "crisis.other_phrasing", "crisis.other_language",
  "adverse.hospital", "adverse.ed_ae", "adverse.ed_lower", "adverse.psychosis", "adverse.seizure", "adverse.chest_pain",
  "adverse.breathing", "adverse.collapse", "adverse.severe_reaction", "adverse.swelling", "adverse.blood",
  "adverse.overdose", "adverse.od", "adverse.od_caps", "adverse.took_whole", "adverse.ingestion",
  "adverse.head_injury_jaundice", "adverse.unresponsive",
]);
/** Crisis rules that match everyday idioms on purpose ("dying to get my order"): not a crisis in an agent's reply. */
const CRISIS_IDIOMS: ReadonlySet<string> = new Set(["crisis.idiom_dying", "crisis.idiom_kill_me"]);
/** Emergency and support services: pointing a patient to them is a hand-over, not advice. */
const EMERGENCY_RE =
  /\b(?:000|111|999|112|triple zero|emergency (?:services|department)|ambulance|lifeline|healthline|samaritans|NHS 111|13 ?11 ?14|poisons? (?:information|info|line|centre|center|helpline)|13 ?11 ?26|healthdirect)\b/i;

/** Words that make "it" or "them" a parcel, a payment or the app rather than the medicine. */
const NOT_DOSE_RE =
  /\b(?:app|link|password|log ?in|account|website|site|page|card|payments?|code|portal|browser|e-?mails?|update|reset|refresh|tracking|courier|parcels?|orders?|deliver\w*|shipments?|dispatch\w*|boxes|reminders?|texts?|messages?|notifications?|plan|subscription|queue|step|form|address|signature|refunds?|charg\w*|bill\w*|invoices?|fees?|prices?|paid|pay|costs?|expensive|cheaper|dearer|banks?|bank holds?|transactions?|funds|pending)\b/i;

/** Words that make "more than" about the medicine ("more than prescribed", "more of the oil than"). */
const OVERUSE_WORD_RE = /\b(?:prescri\w*|recommended|doctor|script|label|clinician|pharmacist|GP|oils?|capsules?|drops|sprays?|doses?|meds|medic\w*)\b/i;
/** "safe with us", "safe with the neighbour": the parcel or the patient's details, not the medicine. */
const SAFE_WITH_ROUTINE_RE = /^\s*(?:us|our team|the (?:neighbou?r|courier|driver|post office|pharmacy|depot)|your neighbou?r)\b/i;

/** The clause around an index: a comma, a semicolon or "and", "but", "if" and similar end it. */
function clauseAt(sentence: string, start: number, end: number): string {
  const splitter = /[,;:()]|\b(?:and|but|so|then|or|because|while|if|once|until)\b/gi;
  let a = 0;
  let b = sentence.length;
  for (const m of sentence.matchAll(splitter)) {
    const i = m.index ?? 0;
    if (i + m[0].length <= start) a = i + m[0].length;
    else if (i >= end) {
      b = i;
      break;
    }
  }
  return sentence.slice(a, b);
}

interface GateRule {
  re: RegExp;
  /**
   * Where to look for words that make the match a parcel or a payment: "clause" (the words around it, for a match
   * that names what it changes) or "sentence" (for "give it a rest", where only the sentence says what "it" is).
   * Omitted: never excused.
   */
  scope?: "clause" | "sentence";
  /** The clause must also have a use verb, a medicine word or "it"/"them" ("use it every other day"). */
  needsUse?: boolean;
  /** Excused in a sentence that only hands over to a clinician ("a clinician will talk you through how much to take"). */
  handoverOk?: boolean;
  /** Excused when "it" or "them" is plainly the patient's plan ("If you'd rather pause it for 1 to 3 months"). */
  planOk?: boolean;
  /** Excused when the clause is plainly about moving a booking (see bookingMoveExcused). */
  bookingOk?: boolean;
}

/** A consult or a booking, as a reply about appointments names it. */
const BOOKING_WORD_RE = /\b(?:consults?|consultations?|appointments?|bookings?|slots?)\b/i;
const DOSE_UNIT_WORD_RE = new RegExp(String.raw`\b${DOSE_UNIT}\b`, "i");
/** Words that make "go up" or "move up" about an amount or how often, even next to a consult ("a little", "between"). */
const DOSE_CHANGE_WORD_RE =
  /\b(?:little|bit|touch|more|less|extra|higher|lower|strength|amount|between|each|every|per|daily|nightly|twice|at a time|at night|a day)\b/i;
/** What follows "up to" or "up by" when a booking moves: a time frame or a day ("up to 24 hours before the consult"). */
const BOOKING_MOVE_TAIL_RE =
  /^\s*(?:\d+|one|two|three|four|five|six|seven|a|an)\s+(?:minutes?|hours?|days?|weeks?|business days?)\b|^\s*(?:the\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December))\b/i;

/**
 * "It is free to move up to 24 hours before the consult" (MSG-0036) is about moving a booking, not a dose. The
 * "go/move up to" rule is excused only when its own clause names a consult, appointment, booking or slot, has no
 * medicine word, dose unit or amount-and-frequency word, and "up to" or "up by" is followed by a time frame or a day.
 * "Move up to 1 mL", "go up by one drop" and "you can go up to 12 hours between doses" stay blocked: a time frame on its
 * own never excuses the match, only a time frame in a clause about a booking.
 */
function bookingMoveExcused(sentence: string, end: number, clause: string): boolean {
  if (!BOOKING_WORD_RE.test(clause)) return false;
  if (MED_WORD_RE.test(clause) || DOSE_UNIT_WORD_RE.test(clause) || DOSE_CHANGE_WORD_RE.test(clause)) return false;
  return BOOKING_MOVE_TAIL_RE.test(sentence.slice(end));
}

/** Dosing advice in an agent's own words, with pronouns, amounts, frequency or timing ("double it", "halve it"). */
const DOSING_ADVICE: GateRule[] = [
  {
    re: /\b(?:halv(?:e|ing)|doubl(?:e|ing)(?![- ]?check)|tripl(?:e|ing)|up|upping|lower(?:ing)?|cut(?:ting)?|reduc(?:e|ing)|increas(?:e|ing)|decreas(?:e|ing)|split(?:ting)?|skip(?:ping)?|spac(?:e|ing)|spread(?:ing)?|stagger(?:ing)?|stretch(?:ing)?|ration(?:ing)?)\s+(?:it|them|that|those|these|what you (?:use|take|have|are (?:using|taking)))\b/i,
    scope: "clause",
  },
  // "Raise it" is a dose change, but "I'll raise it with the team" is an escalation.
  {
    re: /\brais(?:e|ing)\s+(?:it|them|that|those|these)\b(?!\s+(?:with|as|for|in|at|up the)\b|\s+to (?:the|a|our|my|your|their) (?:team|manager|supervisor|lead|complaints|clinician|clinical|pharmacist|pharmacy|courier|bank|warehouse|people)\b)/i,
    scope: "clause",
  },
  // "Go up by one more drop each night", "come down to a lower dose", "bump it up a little".
  // "It is free to move up to 24 hours before the consult" is a booking, not a dose (bookingOk, MSG-0036).
  { re: /\b(?:go|going|come|coming|step|stepping|move|moving)\s+(?:up|down)\s+(?:by|to|a|one|another|half)\b/i, scope: "clause", bookingOk: true },
  {
    re: /\b(?:one|a|another)\s+more\s+(?:drop|capsule|cap|spray|puff|pump|squirt|dose|ml|gummy|tablet)s?\b|\b(?:a|one|another|an extra|half a)\s+(?:drop|capsule|spray|puff|pump|squirt|dose|ml)\s+(?:more|less|extra)\b/i,
    scope: "clause",
  },
  { re: /\bbump(?:ing|ed|s)?\s+(?:it|them|that|(?:the|your)\s+\w+)\s+(?:up|down)\b|\bbump(?:ing)? up (?:the|your) (?:dose|amount|drops|oil)\b/i, scope: "clause" },
  // How often: "take it more often", "use it less often". "We'll send your order more often" is excused by its clause.
  { re: /\b(?:more|less)\s+(?:often|frequently|regularly)\b/i, scope: "clause", needsUse: true, handoverOk: true },
  {
    re: /\b(?:the|your)\s+next\s+(?:one|dose|drop|capsule|spray)\s+(?:sooner|earlier|early|straight away|right away)\b|\b(?:take|have|use)\s+(?:it|them|one|the next one)\s+(?:sooner|earlier)\b/i,
    scope: "clause",
  },
  // More or less than usual: "just use a touch more than usual when it flares", "a wee bit less next time".
  {
    re: /\b(?:use|take|have|try|add)\s+(?:a (?:little|bit|touch|tiny bit|wee bit|smidge|tad) |slightly |some |a lot |much |way )?(?:more|less)\s+than\s+(?:usual|normal|normally|usually|before|you (?:usually|normally|would)|prescribed|recommended|you do|last time)\b/i,
  },
  {
    re: /\b(?:a|a wee|a little|a tiny|slightly)\s+(?:bit|touch|smidge|tad)\s+(?:less|more)\b(?!\s+(?:time|money|patience|info\w*|detail\w*|notice|help|to pay|expensive|cheaper|than (?:we|the courier|usual demand)))/i,
    scope: "clause",
  },
  {
    re: /\b(?:a|an|some|any)\s+(?:little |bit of |touch of |wee bit of |bit )?(?:extra|more)\s+(?:of (?:the|your) )?(?:oil|capsules?|caps|spray|sprays|drops|gummies|tincture|flower|doses?|puffs?)\b/i,
    scope: "clause",
  },
  // Timing around another thing: "leave a couple of hours before your oil".
  {
    re: /\bleave\s+(?:a |an |about |at least )?(?:couple of |few |\d+ |one |two |three |four |half an? )?(?:hours?|mins?|minutes?|hrs?)\s+(?:before|after|between)\b/i,
    scope: "clause",
  },
  // Holding or not changing the amount: "don't change how much you take", "keep things as they are for now".
  {
    re: /\b(?:don['’]?t|do not|no need to|never|try not to)\s+(?:change|alter|adjust|touch|up|lower|increase|reduce)\s+(?:how (?:much|many|often)|when|what) (?:you|u) (?:take|use|have)\b|\bhow (?:much|many|often) (?:you (?:take|use|have)|to (?:take|use|have))\b|\bkeep (?:things|everything) (?:as|the way) (?:they|it) (?:are|is)\b/i,
    scope: "sentence",
    handoverOk: true,
  },
  // How to take it: "hold the drops in your mouth for a minute before you swallow".
  {
    re: /\b(?:hold|keep|leave|swish|put|place|rub|apply)\b[^.!?\n]{0,30}\b(?:in|under|on|inside|around)\s+(?:your|the|his|her)\s+(?:mouth|tongue|cheeks?|gums?|skin|lips)\b|\bbefore (?:you )?swallow\w*\b|\bswallow(?:ing)? (?:it|them|the (?:drops|oil|capsules?))\b/i,
  },
  { re: /\bgo(?:ing)?\s+(?:easy|gently|slow|slowly|steady|light)\s+(?:on|with)\s+(?:it|them|(?:the|your)\s+(?:oil|capsules?|spray|drops|gummies|dose|flower))\b/i },
  // Stopping and restarting: "stop for a couple of days, then start again at the lower amount".
  { re: /\b(?:stop|pause|break|rest|come off)\s+(?:for\s+)?(?:a|an|one|two|three|four|five|a few|a couple of|\d+)\s+(?:days?|nights?|weeks?)\b/i, scope: "sentence" },
  {
    re: /\b(?:start|restart|begin|go back|come back|resume)\s+(?:again\s+|back\s+)?(?:at|on|with)\s+(?:the|a|your)\s+(?:lower|higher|smaller|bigger|starting|original|usual|normal|reduced|half)\s+(?:amount|dose|dosage|strength|drops)\b|\b(?:the|a) (?:lower|higher|smaller|bigger|reduced|starting) (?:amount|dose|dosage)\b/i,
    scope: "sentence",
  },
  {
    re: /\bjust stop\b(?!\s+(?:the |your )?(?:texts?|e-?mails?|messages?|reminders?|notifications?|orders?|deliver\w*|payments?|marketing))|\bstop (?:once|when|as soon as|if|after) (?:you|u)(?:['’]re| are| feel| start)\b|\b(?:no need|don['’]?t need|do not need) to finish (?:the|your|it|them)\b|\bfinish (?:the|your) (?:course|bottle|script|prescription)\b/i,
    scope: "sentence",
  },
  { re: /\bhalv(?:e|es|ed|ing)\b|\bhalf (?:of )?(?:what you (?:use|take|have)|your usual|the usual|a dose|the dose|your dose)\b/i, scope: "clause" },
  {
    re: /\bas (?:much|many|often|little|few) as (?:you|u)(?:['’]d)? (?:need|like|want|wish|feel|can|please|require)\b|\bas (?:much|many|often) as (?:needed|required|necessary)\b/i,
    scope: "clause",
  },
  // Timing by need: "take it whenever the pain comes on", "use one as soon as you feel it", "take the lot at once".
  // "Have them sent as soon as the stock arrives" and "the tracking page is there, use it whenever you like" are not.
  {
    re: new RegExp(
      String.raw`\b(?:take|use|try|have|having|taking|using|pop|swallow)\s+(?:it|them|one|two|another(?:\s+one)?|an extra(?:\s+one)?|one more|${MED_OBJECT_EXT})(?!\s+(?:all\s+)?(?:to|back|in to|into|out|along|down|of|with you|a look|sent|delivered|posted|shipped|dispatched|redirected|held|picked up|collected|left|dropped|changed|updated|moved|resent|re-sent|checked|replaced|refunded|looked at|swapped|packed|fixed|sorted)\b)[^.!?\n]{0,40}?\b(?:whenever|as soon as|each time|every time|any ?time (?:you|the|it)|at once|in one go|all together)\b`,
      "i",
    ),
    scope: "sentence",
  },
  {
    re: /\b(?:use|take|have|try|put in)\s+(?:whatever|however much|however many|as much as|as many as|any amount)\s+(?:amount\s+|dose\s+)?(?:feels right|feels good|you (?:need|like|want|feel like|think)|works(?: for you)?|suits you|helps)\b|\bwhatever (?:amount|dose|dosage)\b/i,
    scope: "clause",
  },
  {
    re: /\b(?:take|have|use|swallow|try)\s+(?:the lot|all of (?:it|them)|the whole (?:bottle|dose|pack|packet|lot|thing|tub|jar)|(?:it|them) all)\b(?!\s+(?:sent|delivered|posted|shipped|dispatched|redirected|held|picked up|collected|left|dropped|changed|updated|moved|resent|re-sent|checked|replaced|refunded|looked at|swapped|packed|fixed|sorted))|\b(?:all|the lot)\s+(?:at once|in one go)\b/i,
    scope: "clause",
    needsUse: true,
  },
  {
    re: /\bno (?:limit|maximum|max|cap|upper limit|set amount)\s+(?:on|to|for)\s+(?:how (?:much|many|often)|the (?:amount|dose|dosage)|your (?:dose|dosage|use|amount))|\b(?:there['’]?s|there is) no (?:limit|maximum|max) (?:on|to) (?:how )?(?:much|many|often|the amount|the dose)/i,
  },
  {
    re: /\bincreas\w*\s+(?:it |them |the dose |your dose |the amount )?[^.!?\n]{0,20}?\b(?:slowly|gradually|bit by bit|little by little|step by step|a little|a bit|until)\b|\b(?:slowly|gradually) (?:increase|decrease|reduce|lower|up|raise|build up)\b/i,
    scope: "clause",
  },
  {
    re: /\b(?:until|till|til) (?:the |your )?(?:pain|symptoms?|anxiety|nausea|headaches?|it|they|sleep)\s+(?:goes away|go away|stops|stop|eases|ease|settles|settle|is gone|are gone|improves|improve|wears off|passes|feels better|comes)/i,
  },
  {
    re: /\b(?:stay|stick|keep going|carry on|continue|remain) (?:on|with|at) (?:your |the )?(?:current |same |usual |normal |present |existing )?(?:amount|dose|dosage|routine|strength|drops)\b/i,
  },
  { re: /\b(?:have|having) (?:a (?:little |bit )?)?less\b(?! (?:time|money|to pay|to wait))|\bless of (?:it|them)\b/i, scope: "clause" },
  {
    re: /\bcut (?:down|back)\b(?!\s+(?:on\s+)?(?:the |your |our )?(?:e-?mails?|messages?|texts?|reminders?|notifications?|orders?|deliver\w*|spending|costs?|number|frequency|charges?|paperwork|wait|waiting|waits|time|times|queues?|delays?|repl(?:y|ies)|responses?|turnaround|hold times?|backlog))/i,
    scope: "clause",
  },
  { re: /\bskip (?:a|one) (?:day|night|dose)\b|\bskip (?:tonight['’]?s|this morning['’]?s|today['’]?s)\b|\bskip (?:days|nights|doses)\b/i },
  { re: /\bspace (?:them|it) out\b|\bspace out (?:the |your )?(?:doses?|drops|capsules|sprays)\b|\bspread (?:them|it) out\b/i, scope: "clause" },
  {
    re: /\b(?:every (?:other|second|third|few|couple of)|once (?:a|per|every)|twice (?:a|per|every)|three times (?:a|per)|(?:every|each) \d+) (?:day|night|morning|evening|week|hours?)s?\b/i,
    scope: "clause",
    needsUse: true,
  },
  {
    re: /\b(?:swap|switch|move|shift|change)\s+(?:the |your |it |them |tonight['’]?s |today['’]?s )?(?:(?:morning|evening|night(?:time)?|bedtime|daytime|afternoon|first|second|last|next)\s+)?(?:(?:dose|doses|capsules?|caps|drops?|spray|sprays|one|oil|gumm(?:y|ies))\s+)?(?:to|into|for|until) (?:the |your )?(?:morning|evening|night|bedtime|afternoon|daytime|later|earlier|lunch(?:time)?|dinner(?:time)?|breakfast)\b(?!\s+(?:run|round|drop|deliver\w*|courier|slot|pick-?up|collection|batch|dispatch|post|van|shift))/i,
    scope: "clause",
  },
  { re: /\bride (?:it|this|them) out\b|\btough (?:it|this) out\b|\bpush through\b/i, scope: "clause" },
  { re: /\bgive (?:it|them|(?:the|your) \w+) a (?:rest|break|miss|pause)\b/i, scope: "sentence" },
  // Topping up: "top it up in the afternoon", "top up with another capsule". "Top up your account" is excused below.
  { re: /\btop(?:ping|ped|s)? (?:it|them|yourself|(?:the|your) \w+) up\b|\btop(?:ping)?[- ]up (?:with|on)\b|\b(?:a|another|an extra) top[- ]up\b/i, scope: "clause" },
  // A little more: "take a little extra when the pain flares", "have some more if you need it", "add a bit extra".
  {
    re: /\b(?:take|use|have|try|add|put in|squirt|give yourself)\s+(?:a (?:little|bit|touch|tiny bit|drop|splash) (?:of )?|some |a little bit |slightly )?(?:extra|more)\b(?!\s+(?:questions?|time|care|information|info|details|days|help|patience|of (?:our|the) (?:app|site|website|portal)|than\b))/i,
    scope: "clause",
  },
  // Going back to an earlier amount or product: "go back to what you were taking before", "return to your old dose".
  {
    re: /\b(?:go|going|went|get|getting|switch|switching|revert|reverting|return|returning|drop|dropping|move|moving)(?: straight| right)? back (?:to|on(?:to)?) (?:what (?:you|u) (?:were|had been|used to be|used to|was) (?:taking|using|having|on)|(?:it|them)\b|(?:(?:the|your) )?(?:oil|capsules?|caps|spray|drops|gummies|flower|tincture|medicine|medication|meds|treatment)\b|(?:your|the) (?:old|previous|original|usual|earlier|last|first|lower|higher|normal|starting|former) (?:dose|dosage|amount|strength|oil|capsules?|product|routine|one|script|prescription|drops|spray))|\brevert(?:ing)? to (?:your|the) (?:old|previous|original|usual|earlier|lower|higher) \w+/i,
    scope: "clause",
  },
  {
    re: /\bleave (?:it|them|(?:the|your) \w+) (?:off |alone )?(?:for|until|till) (?:a|an|one|two|three|four|five|a few|a couple of|\d+|the (?:weekend|week|night)|next|tomorrow|now)\b/i,
    scope: "sentence",
  },
  { re: /\b(?:stop|pause|halt) (?:it|them)\b(?! (?:from|being|going|arriving|coming))/i, scope: "sentence", planOk: true },
];

/** Who or what a harm claim is about: the patient, someone else, a baby, children or a pet ("it won't hurt the dog"). */
const HARM_OBJECT = String.raw`(?:you|your(?!\s+(?:credit|account|card|order|refund|payment|plan|subscription|details|data|privacy|score|bank|inbox|phone|device|app)\b)|anyone|anybody|u|him|her|them|(?:the|your|a|his|her|their) (?:baby|bub|unborn|kids?|children|child|toddler|little one|dog|cat|puppy|kitten|pets?|animals?)|babies|kids|children|pets|dogs|cats)`;

/** Claims about safety or dependence: "you won't get addicted", "it's safe with alcohol", "being natural it can't hurt you". */
const SAFETY_CLAIMS: GateRule[] = [
  // "Nobody gets hooked", "not the kind of medicine people get dependent on". "Dependent on your bank" is not about the
  // medicine, and neither is "we've hooked up a new courier".
  {
    re: /\b(?:addict\w*|habit[- ]forming|hooked\b(?!\s+(?:up|in|into|onto)\b)|dependen(?:ce|cy)|dependent\b(?!\s+on\s+(?:your|the|our|a|an|how|when|where|which|whether|what|stock|supply|availability|demand|courier|bank)\b)|physically dependent)/i,
  },
  // "You won't become reliant on it", "you won't come to rely on the capsules". Relying on a parcel or a card is not.
  {
    re: new RegExp(
      String.raw`\b(?:reliant|reliance)\s+on\s+${MED_OBJECT_EXT}|\b(?:come|comes|came|coming|grow|start|begin|learn)\s+to\s+(?:rely|depend)\s+on\b|\b(?:rely|relying|relies|depend|depending|depends)\s+on\s+${MED_OBJECT_EXT}(?![^.!?\n]{0,15}\b(?:arriv\w*|turn\w* up|get(?:s|ting)? (?:there|to you)|deliver\w*|ship\w*|being (?:sent|posted))\b)`,
      "i",
    ),
    scope: "sentence",
  },
  // Withdrawal or cravings ruled out: "zero chance of withdrawal", "you can stop any time without cravings".
  {
    re: /\b(?:no|zero|without|never|nor|free (?:of|from)|won['’]?t (?:get|have|experience|cause|give you|feel)|don['’]?t (?:get|have|experience)|not (?:get|have|experience))\b[^.!?\n]{0,20}\b(?:withdrawals?|cravings?|tolerance|come[- ]?downs?|rebound)\b|\bstop (?:it |them )?(?:any ?time|whenever you (?:like|want)|at any time|cold turkey)\b/i,
    scope: "sentence",
  },
  // Tolerance in plain words: "you won't build up a need for it", "you won't end up needing more over time".
  {
    re: /\bbuild(?:s|ing)?\s+up\s+(?:a |any |much of a |some )?(?:need|tolerance|reliance|dependence|dependency|habit|resistance)\b|\bneed(?:s|ing|ed)?\s+(?:more|a (?:higher|bigger|stronger|larger) (?:dose|amount)|(?:it|them) more|more and more)(?: of (?:it|them))?\s+(?:over time|as time goes (?:on|by)|after a while|down the track|the longer|in the long run|later on|to get the same)\b/i,
    scope: "sentence",
  },
  // Standard safety wording: "very well tolerated", "an excellent safety profile", "non-psychoactive".
  {
    re: /\b(?:well|easily|generally|usually|widely|very well)[- ]tolerated\b|\btolerated (?:well|by (?:most|nearly|almost|the vast))\b|\bsafety (?:profile|record|track record)\b|\bnon[- ]?(?:psychoactive|intoxicating|impairing|sedating|habit[- ]forming)\b|\b(?:not|isn['’]?t|aren['’]?t|won['’]?t be|never)\s+(?:\w+\s+)?(?:psychoactive|intoxicating|impairing)\b|\b(?:gentle|kind|easy|soft|light)\s+on\s+(?:the|your)\s+(?:body|system|stomach|tummy|gut|liver|kidneys|head|mind)\b|\bkind to (?:the|your) (?:body|system|stomach|gut)\b/i,
    scope: "sentence",
  },
  // Impairment reassurance: "you'll be fine at work", "okay for driving".
  { re: /\b(?:fine|okay|ok|safe|alright|all right|good|right)\s+(?:at|for)\s+(?:work|driving|the wheel|the drive|school|uni|your shift|the office|the road)\b/i, scope: "sentence" },
  // "You won't notice any effect", "barely notice any effect", "you won't feel any different".
  {
    re: /\b(?:barely|hardly|won['’]?t|don['’]?t|wouldn['’]?t|never|not|rarely|scarcely)\s+(?:even\s+)?(?:notice|feel)\s+(?:any|much(?: of)?|an?|the)?\s*(?:effects?|side[- ]effects?|impact|high|buzz|difference)\b|\bwon['’]?t (?:even )?feel (?:any |much |at all )?different\b/i,
    scope: "sentence",
  },
  // A mild medicine: "a very mild medicine", "gentle capsules".
  { re: new RegExp(String.raw`\b(?:mild|gentle|weak|light|soft|low[- ]strength|harmless|natural)\s+(?:little\s+)?${MED_WORD}\b`, "i"), scope: "sentence" },
  // Positive interaction idioms: "plays nicely with most prescription meds", "alcohol and cannabis mix well".
  {
    re: new RegExp(
      String.raw`\b(?:plays?|playing|played)\s+(?:nicely|nice|well|fine|happily)\s+with\b|\b(?:goes?|going|went|sits?|works?)\s+(?:fine|well|okay|ok|nicely|happily)\s+(?:with|alongside)\s+(?:your |the |other |most |any |all )?(?:\w+\s+)?(?:meds|medicines?|medications?|tablets|pills|alcohol|wine|beer|drinks?|prescriptions?|${MED_WORD})\b|\b(?:mix|mixes|mixing|combine|combines|combining)\s+(?:really |very |just )?(?:well|fine|okay|ok|nicely|happily|safely)\b`,
      "i",
    ),
    scope: "sentence",
  },
  // The medicine as the subject of a safety word: "our oil is very gentle", "the capsules are well tolerated".
  {
    re: new RegExp(
      String.raw`\b(?:the|our|your|this|that|these|those)\s+(?:[\w-]+\s+)?${MED_WORD}\s+(?:is|are|['’]s)\s+(?:(?:completely|totally|perfectly|very|really|quite|100%|absolutely|pretty|so|super|nice and|lovely and)\s+)?(?:safe|harmless|non[- ]addictive|gentle|mild|kind|light|natural|clean|pure)\b(?!\s+(?:with us|to (?:store|keep|post|ship|send|return)))`,
      "i",
    ),
    scope: "sentence",
  },
  { re: /\b(?:make|makes|made|get|gets|getting|got|leave|leaves) (?:you |u )?(?:high|stoned|buzzed|impaired|intoxicated|out of it)\b/i },
  {
    re: new RegExp(
      String.raw`\b(?:can['’]?t|cannot|won['’]?t|will not|wouldn['’]?t|couldn['’]?t|doesn['’]?t|does not|shouldn['’]?t|should not|never) (?:do (?:you )?any |cause (?:you )?any )?(?:hurt|harm)s? ${HARM_OBJECT}\b|\b(?:can['’]?t|cannot|won['’]?t|will not|wouldn['’]?t|couldn['’]?t|doesn['’]?t|does not|shouldn['’]?t|should not|never) (?:do|cause) (?:${HARM_OBJECT} )?any (?:harm|damage)\b|\b(?:do|does|cause|causes) (?:${HARM_OBJECT} )?(?:no|any) (?:harm|damage)\b`,
      "i",
    ),
  },
  // "There's nothing in it that could hurt the baby". An email or an account in the sentence excuses it.
  {
    re: new RegExp(String.raw`\bnothing\b[^.!?\n]{0,40}\b(?:could|would|can|will|might|that['’]?(?:d|ll))\s+(?:\w+\s+)?(?:hurt|harm|damage|affect|upset)\s+${HARM_OBJECT}\b`, "i"),
    scope: "sentence",
  },
  // "It won't damage your liver": damage to a person's body, not to a card or a credit score (excused by its clause).
  {
    re: new RegExp(String.raw`\b(?:can['’]?t|cannot|won['’]?t|will not|wouldn['’]?t|couldn['’]?t|doesn['’]?t|does not|shouldn['’]?t|should not|never) damage ${HARM_OBJECT}\b`, "i"),
    scope: "clause",
  },
  // A harm word ruled out with no one named: "the oil isn't dangerous at all", "kids getting into it wouldn't be
  // dangerous". Needs "it", "them" or a medicine word; a card or the app in the sentence excuses it.
  {
    re: /\b(?:not|isn['’]?t|aren['’]?t|never|won['’]?t be|wouldn['’]?t be|shouldn['’]?t be|can['’]?t be|couldn['’]?t be|is not|are not|will not be|would not be|nothing)\s+(?:\w+\s+)?(?:dangerous|harmful|toxic|poisonous|risky|unsafe|deadly|lethal|hazardous)\b/i,
    scope: "sentence",
    needsUse: true,
  },
  // Safety by comparison: "about as risky as a cup of coffee", "less harmful than smoking", "the least harmful option".
  {
    re: /\b(?:as|no more|not much more|not any more|less|far less|much less|way less|a lot less|no less|about as|just as|not as|nowhere near as)\s+(?:risky|dangerous|harmful|safe|addictive|toxic|habit[- ]forming|bad for you|damaging)\s+(?:as|than)\b|\b(?:least|less) (?:harmful|risky|dangerous|addictive|damaging)\b|\bsafer (?:than|option|choice|alternative|bet)\b/i,
    scope: "sentence",
  },
  // Next-day effects ruled out: "it won't give you a hangover", "no groggy mornings".
  {
    re: /\b(?:won['’]?t|will not|doesn['’]?t|does not|shouldn['’]?t|should not|never|wouldn['’]?t|no|without)\s+(?:give|leave|make|giving|leaving|making)?\s*(?:you|u|him|her|them)?\s*(?:with\s+)?(?:a |any |the |feeling )?(?:hangover|hung ?over|groggy|grogginess|foggy|fogginess|seedy|dopey|next[- ]day (?:effects?|drowsiness|grogginess|fog)|morning[- ]after (?:effects?|feeling))\b/i,
    scope: "sentence",
  },
  // Food and drink with "it": "coffee is fine with it", "grapefruit is okay alongside them".
  {
    re: /\b(?:coffee|tea|caffeine|energy drinks?|juice|grapefruit|food|dairy|milk|meals?|alcohol|drinks?|smoking|nicotine|vaping)\b[^.!?\n]{0,30}\b(?:fine|ok|okay|safe|alright|all right|no problem|not a problem|good)\s+(?:with|alongside|on top of|together with)\s+(?:it|them)\b/i,
  },
  {
    re: /\bbeing natural\b|\b(?:it['’]?s|it is|they['’]?re|they are|this is|cannabis is) (?:(?:all|completely|totally|purely|100%|just) )?natural\b(?! to\b)|\bnatural\b[^.!?\n]{0,25}\b(?:safe|harmless|gentle|can['’]?t hurt|no harm)\b/i,
  },
  {
    // "no side effects", "no nasty effects", "no real risks", "without any bad reactions".
    re: /\b(?:no|zero|without (?:any )?)(?: (?:known|real|nasty|bad|harmful|serious|major|negative|unpleasant|lasting|long[- ]term|adverse|ill|big|horrible|nasty little))* (?:side[- ]effects?|after[- ]effects?|risks?|dangers?|downsides?)\b|\b(?:no|zero|without (?:any )?)(?: (?:real|known))? (?:nasty|bad|harmful|serious|negative|unpleasant|lasting|long[- ]term|adverse|ill|horrible) (?:effects?|reactions?)\b/i,
    scope: "sentence",
  },
  // "being plant based, it ...", "it's herbal, so it's gentle", "plant-based means no nasty effects".
  {
    re: /\bbeing (?:plant[- ]based|plant[- ]derived|herbal|organic|from a plant|a plant)\b|\b(?:plant[- ]based|plant[- ]derived|herbal|organic|from (?:a|the) plant)\b[^.!?\n]{0,40}\b(?:safe|harmless|gentle|can['’]?t hurt|won['’]?t hurt|no harm|no (?:\w+ )?(?:side )?effects?|nothing (?:bad|harmful)|natural)\b/i,
  },
  {
    re: /\b(?:safe|harmless|risk[- ]free)\s+(?:with|alongside|while|during|for (?:you|pregnancy|your|long[- ]term|everyone|kids|children|older)|if you|when you|to use|long[- ]term|in pregnancy|in the long run)\b(?! us\b| the (?:neighbou?r|courier|driver|post office|pharmacy)\b)/i,
    scope: "sentence",
  },
  { re: /\byou (?:can['’]?t|cannot|won['’]?t|will not) (?:overdose|OD|have too much|take too much|use too much|get too much)\b/i },
  {
    re: /\b(?:won['’]?t|will not|doesn['’]?t|does not|shouldn['’]?t|should not|never) (?:affect|impair|interfere with|show up (?:in|on)) (?:you|your (?:driving|work|sleep|mood|memory|breathing|heart|test|ability|other|job|drug test)|the (?:test|results)|a (?:drug|roadside|saliva) test)\b/i,
  },
  {
    // "It's safe to throw away the old packaging" is an app, account or packaging step.
    re: new RegExp(
      String.raw`\b(?:it['’]?s|it is|they['’]?re|they are|cannabis is|the (?:oil|capsules|spray|flower|product|gummies) (?:is|are)) (?:(?:completely|totally|perfectly|very|really|quite|100%|absolutely|pretty) )?(?:safe|harmless|non[- ]addictive|gentle)\b(?!\s+(?:with us|to (?:store|keep|post|ship|send|return))|\s+to${SAFE_TO_ROUTINE})`,
      "i",
    ),
    scope: "sentence",
  },
  // Interactions: "it won't clash with your capsules", "it doesn't react with other medicines".
  {
    re: /\b(?:won['’]?t|wont|doesn['’]?t|does not|shouldn['’]?t|should not|will not|never|don['’]?t|do not)\s+(?:clash|interact|react|conflict|interfere|mix badly|cause (?:any )?(?:problems?|issues?|trouble|harm))\b/i,
    scope: "sentence",
  },
  // Harm claims for a person or an animal: "the capsules aren't harmful to dogs".
  {
    re: /\b(?:not|isn['’]?t|aren['’]?t|never|won['’]?t be|wouldn['’]?t be|is|are|['’]s|['’]re)\s+(?:\w+\s+)?(?:harmful|toxic|poisonous|dangerous|deadly|lethal|bad)\s+(?:to|for)\s+(?:dogs?|cats?|pets?|animals?|kids|children|babies|you|him|her|them|people|anyone|your|a (?:dog|cat|child|baby))\b/i,
  },
  // Ruling the medicine out as a cause: "it's nothing to do with her spray", "they won't have caused what happened".
  {
    re: /\b(?:won['’]?t|wouldn['’]?t|couldn['’]?t|can['’]?t|didn['’]?t|did not|will not|would not|could not|cannot)\s+have\s+caused\b|\b(?:didn['’]?t|did not|doesn['’]?t|does not|won['’]?t|can['’]?t)\s+cause\b|\bnothing to do with\b|\bnot (?:caused by|down to|because of|related to|linked to)\b|\bunrelated to\b/i,
    scope: "sentence",
  },
  // "Tipping it out is the safest option", "it's fine to give him", "still okay to use after the date on the label".
  { re: /\b(?:safest|safer|the safe)\s+(?:option|thing|bet|choice|way|approach)\b/i, scope: "sentence" },
  { re: /\b(?:fine|ok|okay|safe|alright|all right)\s+to\s+(?:give|feed|pass|use|take|have|drink|eat|mix)\b/i, scope: "sentence" },
  {
    re: /\b(?:fine|ok|okay|safe|suitable|good|alright|appropriate|perfect)\s+for\s+(?:someone|somebody|people|anyone|a person|patients?|women|men|kids|children|teens?|teenagers|older|elderly|seniors|pregnant|your age|you at|a \d+|(?:an? )?(?:older|younger|young|elderly) \w+)\b/i,
    scope: "sentence",
  },
  // Food and drink with the medicine: "grapefruit juice is fine with the capsules".
  {
    re: new RegExp(String.raw`\b(?:fine|ok|okay|safe|alright|all right|no problem|not a problem|good)\s+(?:to (?:have|take|use|mix|combine)\s+)?(?:with|alongside|together with|on top of)\s+(?:the |your |this |those |these )?${MED_WORD}\b`, "i"),
  },
  // Long-term use with no problems: "plenty of people use it for years with no problems at all".
  {
    re: new RegExp(
      String.raw`\b(?:use|uses|using|used|take|takes|taking|took|been on|stay on|staying on)\s+(?:it|them|${MEDICINE_NOUN}|(?:(?:medicinal|medical|prescribed|prescription|legal)\s+)?(?:cannabis|CBD|THC|oils?|capsules?|flower|gummies|sprays?|drops|tinctures?))\b[^.!?\n]{0,40}\b(?:(?:no|without (?:any )?)\s*(?:problems?|issues?|trouble|dramas|side[- ]effects?|worries|incident|harm)|for (?:years|decades|ages|a long time|life|the long (?:term|haul))|every (?:single )?(?:day|night)|daily|each day|day in,? day out|long[- ]term)\b`,
      "i",
    ),
    scope: "sentence",
  },
  // Out-of-date product: "still okay to use after the date on the label".
  { re: /\b(?:after|past|beyond)\s+(?:the|its)\s+(?:expiry|use[- ]by|best[- ]before)(?:\s+date)?\b|\bafter the date on the (?:label|bottle|box|pack)\b|\bout of date\b|\bexpired\b/i, scope: "sentence", needsUse: true },
];

const STRAIN = String.raw`(?:strains?|cultivars?|chemovars?|indica|sativa|hybrids?|terpenes?)`;
const EFFECT = String.raw`(?:calm\w*|relax\w*|uplift\w*|energi[sz]\w*|sedat\w*|sooth\w*|mellow|euphori\w*|happy|focus\w*|sleepy|creative|chilled?|gentle|gentler|strong|stronger|mild|milder|potent|heavy|heavier|light|lighter|smooth|harsh)`;
const STRAIN_OR_MED_RE = new RegExp(String.raw`\b(?:${MED_WORD}|${STRAIN}|this one|that one)\b`, "i");

/** Claims about what the product does, strain effects, comparisons and recommendations (restricted in AU, NZ and the UK). */
const PRODUCT_CLAIMS: (GateRule & { needsMed?: boolean })[] = [
  { re: new RegExp(String.raw`\b${STRAIN}\b[^.!?\n]{0,40}?\b${EFFECT}\b|\b${EFFECT}\b[^.!?\n]{0,40}?\b${STRAIN}\b`, "i") },
  {
    re: /\b(?:really|very|so|quite|super|nicely|more|less|most|pretty|incredibly|extremely|lovely and|beautifully)\s+(?:calming|relaxing|soothing|sedating|uplifting|energi[sz]ing|mellow)\b|\b(?:calming|relaxing|soothing|sedating|uplifting|energi[sz]ing)\s+(?:effect|effects|oil|strain|product|option|choice|one|blend)\b/i,
  },
  {
    re: /\b(?:gentler|stronger|milder|weaker|smoother|harsher|kinder|more (?:potent|effective|gentle|relaxing|calming|powerful|concentrated)|less (?:potent|effective|harsh|strong)|faster[- ]acting|longer[- ]lasting|work(?:s|ed|ing)? (?:better|best|faster|quicker|well|great|wonders|for (?:most|many|lots of))|better (?:for you|for your|than|option|choice|suited))\b/i,
    scope: "sentence",
    needsMed: true,
  },
  {
    re: new RegExp(
      // "You'd like the capsules better", but not "if you would like" / "whenever you'd like" (an offer, not a claim).
      String.raw`(?<!\b(?:if|whenever|as|what|when|however|whatever|wherever|whichever|anything)\s)\byou(?:\s+(?:might|may|would|will|could)|['’]d)(?: really| probably| definitely)? (?:prefer|like|enjoy|love|find (?:it|them|the))\b|\b(?:i|we)(?:['’]d| would)? (?:recommend|suggest|go (?:with|for))\b|(?<!\b(?:a|an|the|any|this|that|no|one|each|every)\s)\b(?:switch|swap|change|move)(?:ing)? (?:over )?to (?:the |our |a )?(?:\w+ )?(?:${MED_WORD}|${STRAIN}|flower)\b|\b(?:try|trying|give) (?:the |our )?(?:spray|oil|capsules?|flower|gummies|vape|tincture|drops|other|different|stronger|milder|gentler|new)\b`,
      "i",
    ),
    scope: "sentence",
    needsMed: true,
  },
  // Effect idioms: "take the edge off", "does wonders", "our patients swear by it", "works a treat".
  {
    re: /\btakes? the edge off\b|\bdo(?:es)? wonders\b|\bswear(?:s)? by\b|\bworks? a treat\b|\bgame[- ]?changer\b|\blife[- ]?saver\b|\bmagic for\b|\bsleep(?:s|ing)? like a (?:baby|log)\b|\bout like a light\b|\bright as rain\b|\bgood as new\b|\b(?:feel like |be )?a (?:new|different) (?:person|man|woman)\b|\bfeel(?:ing)? like (?:your|him|her|them)sel(?:f|ves) again\b/i,
    scope: "sentence",
  },
  // Comparative effects promised to the patient: "you won't feel any different apart from calmer", "you'll feel calmer".
  {
    re: /\b(?:you['’]ll|you will|you['’]d|you would|you should|makes? you|made you|leaves? you|left you|apart from|except|other than)\s+(?:feel(?:ing)?\s+|be\s+)?(?:a (?:lot|bit|little) |much |far |so much )?(?:calmer|more relaxed|less anxious|less stressed|more chilled|less wired|more rested|more focused|sleepier|happier|less tense|pain[- ]free)\b/i,
  },
  // Outcomes promised to the patient: "you'll sleep soundly on these", "you'll wake up refreshed", "you'll feel yourself
  // again", "you'll notice your appetite come back". A parcel or a refund in the sentence excuses it.
  {
    re: /\b(?:you['’]ll|you will|you should|you['’]d|you['’]re going to|he['’]ll|she['’]ll|they['’]ll)\s+(?:(?:soon|finally|probably|definitely|really|actually|quickly)\s+)?(?:sleep (?:soundly|well|better|through|like|deeply|properly)|wake (?:up )?(?:refreshed|rested|pain[- ]free|fresh|feeling (?:great|good|better|fresh|rested))|feel (?:(?:like )?(?:your|him|her|them)sel(?:f|ves)(?: again)?|(?:so much |much |a lot |heaps )?(?:better|great|fantastic|amazing|normal|human|brand new) again)|notice (?:your|the|a|an|his|her)\s+(?:\w+\s+)?(?:appetite|sleep|pain|mood|energy|anxiety|symptoms?|improvement)|get (?:your|his|her|their) (?:appetite|sleep|energy|life|mojo|spark) back|be (?:pain[- ]free|back to normal|back to (?:your|his|her|their) old sel(?:f|ves)))/i,
    scope: "sentence",
  },
  {
    re: new RegExp(
      String.raw`\b(?:say goodbye to|kiss goodbye to|goodbye to|bye[- ]bye to|farewell to|no more|put an end to|an end to)\s+(?:\w+\s+){0,3}?${CONDITION_RE.source}|${CONDITION_RE.source}[^.!?\n]{0,30}\b(?:a thing of the past|history|gone for good)\b`,
      "i",
    ),
  },
  // Outcomes promised with no subject: "for better sleep", "less pain", "great results for arthritis".
  { re: /\bbetter (?:sleep|nights?|night['’]?s sleep|mood|rest|quality of life|pain relief|pain control)\b/i },
  {
    re: /\b(?:less|fewer|reduced|lower|decreased|much less|a lot less|far less|way less)\s+(?:pain|anxiety|nausea|inflammation|seizures?|migraines?|headaches?|flare[- ]?ups?|spasms?|cramps?|insomnia|symptoms?|stiffness|aches?|tremors?|sleepless nights)\b/i,
  },
  // Comparisons: "the flower acts faster", "the capsules last longer", "much easier to take than the oil".
  {
    re: /\b(?:acts?|acting|works?|working|kicks? in|lasts?|lasting|wears? off)\s+(?:a (?:lot|bit|little) |much |way |far |heaps )?(?:faster|quicker|slower|longer|shorter|sooner|better|more (?:quickly|slowly))\b|\b(?:easier|harder|nicer|simpler|gentler|kinder|better|stronger|milder|smoother)\s+(?:to take|to use|to swallow|on (?:the|your) (?:stomach|tummy|throat|lungs|chest))\b|\b(?:much|far|way|a lot|heaps|loads)\s+(?:better|nicer|stronger|gentler|milder|smoother|more effective)\b|\bbetter for\b/i,
    scope: "sentence",
    needsMed: true,
  },
  // Recommendations: "the one to go for", "I think you'll prefer them", "worth a try".
  {
    re: /\bthe one (?:to go for|to get|to pick|to choose|to try|for you)\b|\b(?:your|a) (?:best|good) bet\b|\bgo-?to (?:for|option|product)\b|\bworth (?:a )?try(?:ing)?\b|\byou['’]ll (?:prefer|like|love|enjoy)\b|\bI think you['’]d\b|\bI['’]?d (?:go with|pick|choose)\b/i,
    scope: "sentence",
    needsMed: true,
  },
  // Testimonials: "most patients find the spray much better", "people love it".
  {
    re: /\b(?:patients|people|customers|folks|most|many|lots of (?:people|patients|our patients)|everyone|loads of (?:people|patients))\b[^.!?\n]{0,30}\b(?:find|finds|say|says|swear|love|loves|prefer|prefers|rave|rate|rates|report|reports|reported|notice|notices|noticed|see|sees|get|gets|feel|feels|tell us)\b/i,
    scope: "sentence",
    needsMed: true,
  },
  // The medicine or a strain as the one that helps: "our indica will help you sleep", "the oil helped her so much".
  {
    re: new RegExp(String.raw`\b(?:${MED_WORD}|${STRAIN})\b[^.!?\n]{0,25}\b(?:helps?|helped|helping|will help|should help|can help|could help|would help|worked|works)\b`, "i"),
    scope: "sentence",
  },
  // Promised outcomes: "you'll feel a big difference", "this will sort your sleep out", "your pain will be under control".
  { re: /\b(?:feel|notice|see)\s+a\s+(?:big |real |huge |massive |noticeable |good |clear |marked )?difference\b/i, scope: "sentence" },
  { re: /\bsort(?:s|ing|ed)?\s+(?:out\s+)?(?:your|the|her|his)\s+(?:\w+\s+)?(?:sleep|sleeping|pain|anxiety|nausea|symptoms?|mood|appetite|back|nerves|insomnia|flare[- ]?ups?|migraines?|headaches?)\b/i },
  {
    re: /\b(?:pain|symptoms?|anxiety|sleep|nausea|flare[- ]?ups?|seizures?|condition|mood|migraines?|headaches?|insomnia|stiffness|arthritis|aches?|spasms?|cramps?|tension)\b[^.!?\n]{0,30}\b(?:under control|at bay|sorted|go away|disappear|be gone|improve|get better|be better|ease off|clear up|(?:much |far |a lot |way |so much )?(?:easier|simpler) to (?:manage|control|live with|handle|cope with|deal with))\b/i,
  },
  { re: /\b(?:I|we) (?:can )?(?:promise|guarantee)\b|\bdefinitely (?:help|work|sort|fix|improve|make)\b|\bwill definitely\b/i, scope: "sentence" },
];

/**
 * Clinical acts an agent cannot take or suggest (P3.1, P6.1, P10.1, P11.1): sharing or passing on prescription
 * medicine, swapping a product, and triage (deferring care, or no need to see anyone).
 */
const CLINICAL_ACTS: GateRule[] = [
  // Sharing: "your partner can use some of yours", "we can send his remaining capsules to you".
  {
    re: /\b(?:use|take|have|borrow|try|share)\s+(?:some|a bit|a few|one|any)\s+of\s+(?:yours|your (?:oil|capsules?|spray|drops|gummies|medicine|meds|script|prescription))\b|\b(?:borrow|lend)\b[^.!?\n]{0,30}\b(?:yours|oil|capsules?|spray|drops|gummies|medicine|meds)\b/i,
  },
  {
    re: /\b(?:his|her|their|[A-Z][a-z]+['’]s)\s+(?:remaining |leftover |left[- ]over |unused |spare |old )?(?:oil|capsules?|spray|drops|gummies|medicine|medication|meds|prescription|script)\b[^.!?\n]{0,30}\b(?:to|for|with)\s+(?:you|yourself)\b|\b(?:his|her|their)\s+(?:remaining|leftover|left[- ]over|unused|spare)\s+(?:oil|capsules?|spray|drops|gummies|medicine|medication|meds)\b/i,
  },
  // An agent swapping the product: "I've swapped you onto the capsules", "we've swapped your capsules for the oil".
  {
    re: new RegExp(
      String.raw`\b(?:i|we)(?:['’]ve|['’]ll|['’]d| have| will| can| could| would)?\s+(?:just\s+|now\s+|already\s+|gone ahead and\s+)?(?:swap|switch|chang|mov|put|substitut)\w*\s+(?:you|it|them|(?:your|the)\s+(?:\w+\s+)?(?:oil|capsules?|caps|spray|drops|gummies|flower|product|order|script|prescription))?\s*(?:onto|on to|over to|to|for|with|across to)\s+(?:the |a |our |some |an? )?(?:\w+[ -])?(?:oils?|capsules?|caps|sprays?|drops|gumm(?:y|ies)|tinctures?|flower|vapes?|cartridges?|blends?|strains?)\b`,
      "i",
    ),
  },
  // Triage: "no need to see anyone before your follow-up", "it can wait until your follow-up on the 1st".
  {
    re: /\bno need (?:to|for) (?:see|call|contact|speak to|talk to|ring|bother)\s+(?:anyone|anybody|someone|a (?:doctor|GP|clinician)|your (?:doctor|GP))\b|\b(?:it|this|that|they|these|those|the \w+) (?:can|could|should|will) (?:wait|hold off|keep)\s+(?:until|till|til|for)\s+(?:your|the|next|a)\s+(?:\w+\s+)?(?:follow[- ]?up|appointment|appt|consult\w*|review|check[- ]?up|visit|GP|doctor)\b/i,
  },
];

/** A dose form or product an agent might tell the patient to change to, apply or alter (round 4 red team). */
const FORM_WORD = String.raw`(?:oils?|flower|capsules?|caps|gumm(?:y|ies)|sprays?|tinctures?|vapes?|cartridges?|strains?|products?|balms?|creams?|topicals?|drops|tablets?|one)`;

/**
 * More clinical acts in an agent's own words (round 4 red team): delaying emergency help or a GP, telling the patient
 * to keep something from their doctor, changing strength or product, how to apply, heat, space out or take the product
 * with food, sharing it, a child or pet using it, how long it stays in the body, and being fine to work the next day.
 * None has a support meaning in the words it needs, so none is excused.
 */
const CLINICAL_ACTS_EXTRA: GateRule[] = [
  // Delaying emergency help: "Don't call 000 yet", "you don't need to ring 999 for this", "hold off on the ambulance".
  // "Don't wait, call 000 now" and "don't hesitate to ring 111" are hand-overs, and "don't drive, and call 000" is two
  // instructions, so the words between may not hold a comma, "and" or "or".
  {
    re: /\b(?:don['’]?t|do not|dont|no need to|(?:there['’]?s|there is) no need to|(?:you )?(?:don['’]?t|do not) (?:need|have) to|needn['’]?t|shouldn['’]?t|no rush to)(?!\s+(?:wait|hesitate|delay|hold off|put (?:it|this|that) off|leave it|be afraid|forget|worry about))(?:(?!\b(?:and|or|but)\b)[^.!?\n,;]){0,25}?\b(?:call|calling|ring|ringing|phone|phoning|dial|dialling|dialing|contact|contacting|get|getting|go to|going to|head to|heading to)\s+(?:an? |the )?(?:000|111|999|112|triple zero|ambulance|ambos?|emergency|ED\b|A ?& ?E|A and E|emergency department|hospital)|\b(?<!(?:don['’]?t|do not|dont|never|not)\s+)(?:hold off|holding off|wait|waiting|delay|delaying|put off|putting off)(?:\s+(?:on|with|before|until|till|a (?:bit|while|little|few \w+)|for (?:a (?:bit|while)|now)))*\s+(?:(?:calling|ringing|phoning|dialling|dialing|getting|contacting)\s+)?(?:an? |the )?(?:000|111|999|112|triple zero|ambulance|ambos?|emergency (?:services|department)|ED\b|A ?& ?E|A and E|hospital)/i,
  },
  // Delaying a GP: "hold off on seeing your GP", "leave it a few days before seeing the doctor", "give it a week before
  // you call your GP". "Give it a day for the tracking to update" names no doctor.
  {
    re: /\b(?<!(?:don['’]?t|do not|dont|never|not)\s+)(?:(?:hold off(?: on)?|holding off(?: on)?|put off|putting off|wait|delay)\b(?:\s+(?:a|an|one|two|three|a few|a couple of|another|for|until|till|\d+)?\s*(?:days?|weeks?|while|bit|fortnight|month|now|longer))?|(?:leave|give) it\s+(?:a|an|one|two|three|a few|a couple of|another|\d+)\s+(?:more\s+)?(?:days?|weeks?|while|bit|fortnight|month))[^.!?\n,;]{0,15}?\b(?:before|until|till|then|on)?\s*(?:you\s+)?(?:see|seeing|call|calling|ring|ringing|visit|visiting|contact|contacting|book(?:ing)?(?: in)? with|speak(?:ing)? to|talk(?:ing)? to|go(?:ing)? to|get(?:ting)? in touch with)\s+(?:a |an |your |the |our )?(?:GP|doctor|clinician|nurse|pharmacist|specialist|prescriber)s?\b/i,
  },
  // Keeping it from the doctor: "No need to mention it to your doctor", "don't bother telling your GP".
  {
    re: /\b(?:no need to|(?:there['’]?s|there is) no need to|don['’]?t (?:bother|need to|have to)|do not (?:bother|need to|have to)|needn['’]?t|shouldn['’]?t|should not|don['’]?t|do not|best not to|I wouldn['’]?t)\s+(?:bother\s+)?(?:(?:mention|mentioning|tell|telling|inform|informing|report|reporting|raise|raising|bring|bringing)\b(?:\s+(?:it|this|that|them|anything|any of (?:it|this))(?:\s+up)?)?\s+(?:to|with)?\s*(?:your |the |a |our )?(?:GP|doctor|clinician|pharmacist|specialist|prescriber|nurse)s?\b|(?:let|letting)\s+(?:your |the |a |our )?(?:GP|doctor|clinician|pharmacist|specialist|prescriber|nurse)s?\s+know\b)/i,
  },
  // Product or strength changes: "Switch to the 20:1 oil", "try the higher-strength flower next time". A plan or a
  // payment method is not a product.
  {
    re: new RegExp(
      String.raw`\b(?:switch|switching|swap|swapping|change|changing|move|moving|go|going|try|trying|upgrade|step up|drop down|stick)\s+(?:over\s+)?(?:(?:to|onto|on to|with)\s+)?(?:the|a|our|your|some)\s+(?:\d+\s*:\s*\d+|higher[- ]strength|lower[- ]strength|high[- ]strength|low[- ]strength|full[- ]strength|stronger|weaker|milder|gentler|balanced|THC[- ](?:dominant|rich|heavy)|CBD[- ](?:dominant|rich|heavy)|full[- ]spectrum|broad[- ]spectrum|\d+\s*mg(?:\s*\/\s*ml)?|\d+\s*%|indica|sativa|hybrid)\s+(?:\w+[- ])?${FORM_WORD}\b`,
      "i",
    ),
  },
  // How to apply a topical: "Apply the balm directly to the sore", "put the cream on the rash twice a day".
  {
    re: /\b(?:apply|applying|put|putting|rub|rubbing|spread|spreading|massage|massaging|dab|dabbing|smear|smearing|use)\s+(?:(?:the|your|some|a (?:little|bit|small amount) of|a thin layer of|a thin film of)\s+)?(?:\w+\s+)?(?:balm|cream|oil|topical|ointment|salve|lotion|gel|rub|roll-?on)s?\s+(?:(?:directly|straight|right|gently)\s+)?(?:on(?:to)?|to|into|over|across)\s+(?:the |your |any |a |that |his |her )?(?:\w+\s+)?(?:rash|rashes|sores?|skin|joints?|wounds?|cuts?|area|spots?|knees?|back|hands?|feet|foot|neck|shoulders?|muscles?|scars?|burns?|patch(?:es)?|elbows?|hips?|wrists?|ankles?|face|lips?|gums|chest|temples|forehead|bump|bruises?|blisters?)\b|\b(?:apply|put|rub|spread|massage)\s+(?:(?:the|your|some)\s+)?(?:balm|cream|topical|ointment|salve|lotion|gel)s?\b[^.!?\n]{0,30}?\b(?:twice|once|three times|every|each|a day|daily|morning and night|at night)\b/i,
  },
  // Heating the product: "Heat the flower to 180 degrees in the vaporiser". Storage temperatures are far below 100.
  {
    re: /\b(?:1\d{2}|2\d{2}|3\d{2}|4[0-5]\d)\s*(?:°\s*[CF]?|degrees?(?:\s*[CF]\b)?|C\b)[^.!?\n]{0,40}?\b(?:vapori[sz]\w*|vapes?|vaping|flower|dry herb|device)\b|\b(?:vapori[sz]\w*|vapes?|vaping|flower|dry herb|heat|set|warm)\b[^.!?\n]{0,40}?\b(?:1\d{2}|2\d{2}|3\d{2}|4[0-5]\d)\s*(?:°\s*[CF]?|degrees?(?:\s*[CF]\b)?|C\b)/i,
  },
  // Altering the dosage form: "crush the capsules into yoghurt", "grind up a gummy", "dissolve it in tea".
  {
    re: /\b(?:crush|crushing|grind|grinding|dissolve|dissolving|break open|breaking open|bite into|chew up|mash|pierce|puncture)\s+(?:up\s+)?(?:the |a |your |one of the |one |some )?(?:capsules?|caps|tablets?|gumm(?:y|ies)|pills?|softgels?|it|them)\b(?!\s+(?:box|boxes|packaging|parcel|seal|lid|cardboard))/i,
  },
  // Food and absorption: "Eat something fatty with it so it absorbs better".
  {
    re: /\b(?:absorb\w*|absorption|bioavailab\w*|uptake)\b[^.!?\n]{0,40}?\b(?:food|fatty|fats?|meals?|milk|butter|snack|breakfast|dinner|lunch|avocado|nuts|cheese)\b|\b(?:food|fatty|fats?|meals?|milk|butter|snack|breakfast|dinner|lunch|avocado|nuts|cheese)\b[^.!?\n]{0,40}?\b(?:absorb\w*|absorption|bioavailab\w*)\b/i,
  },
  // Spacing doses: "Spread the drops out over the day", "space the capsules across the evening".
  {
    re: /\b(?:spread|spreading|space|spacing|stagger|staggering|split|splitting|divide|dividing|break up|breaking up)\s+(?:out\s+)?(?:the|your|those|these|a few|some)?\s*(?:\w+\s+)?(?:drops|doses?|dosage|capsules?|caps|gumm(?:y|ies)|sprays?|puffs?|squirts?|mls?)\s+(?:out\s+)?(?:over|across|through(?:out)?|during|between)\s+(?:the|a|each|every|your|morning)\s*(?:day|night|evening|morning|afternoon|week|and)?\b/i,
  },
  // Sharing: "Share a gummy with your partner if they're struggling".
  {
    re: /\bshare\s+(?:a|one|some|your|a few|a couple of|half (?:a|your)|any)\s+(?:\w+\s+)?(?:gumm(?:y|ies)|capsules?|caps|doses?|oil|drops|flower|spray|tablets?|medicine|meds|medication|vape|tincture)\s+with\b/i,
  },
  // A child or a pet using it: "Your 15 year old can use it", "pets can have a little". "Your 15% discount" is money.
  {
    re: new RegExp(
      String.raw`\b(?:\d+[- ]?(?:year|yr)[- ]?olds?|child|children|kids?|teens?|teenagers?|sons?|daughters?|bab(?:y|ies)|toddlers?|pets?|dogs?|cats?|pupp(?:y|ies)|kittens?|grandkids?|grandchild(?:ren)?|little ones?|minors?|under[- ]?18s?)\s+(?:can|could|may|should|will|are (?:fine|okay|ok|allowed) to|is (?:fine|okay|ok|allowed) to)\s+(?:safely\s+|also\s+|still\s+)?(?:use|have|take|try|share|eat)\s+(?:it|them|a little|a bit|some|one|half|this|a (?:little|small) (?:bit|amount|dose)|(?:the|a|some|your)\s+(?:\w+\s+)?${MED_WORD})\b`,
      "i",
    ),
  },
  // How long it lasts in the body: "It stays in your system for about a week", "the effect lasts about six hours".
  {
    re: /\b(?:stays?|staying|stay|lingers?|lingering|remains?|hangs? around) in (?:(?:your|his|her|their) (?:system|body|blood|bloodstream|urine|hair|wee|pee)|the (?:body|blood|bloodstream|urine))\b|\b(?:clears?|clearing|cleared|leaves?|leaving|flushes?|flushed|flush|gone from|out of) (?:out of )?(?:(?:your|his|her|their) (?:system|body|bloodstream)|the (?:body|bloodstream))\b|\b(?:the )?(?:effects?|high|buzz|sedation|drowsiness|sleepiness|relief)\s+(?:usually |typically |normally |generally |should |will |can |tends? to |only )?(?:lasts?|last|wears? off|wear off|kicks? in|kick in|peaks?|peak|fades?|fade)\b[^.!?\n]{0,25}?\b(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|few|couple|several|half)\b[^.!?\n]{0,10}?\b(?:minutes?|mins?|hours?|hrs?|days?)\b/i,
  },
  // Next-day impairment cleared: "You'll be fine to work the next morning".
  {
    re: /\b(?:fine|okay|ok|good|safe|alright|all right|right|clear|able)\s+to\s+(?:work|drive|operate|ride|fly|cycle|go (?:to|back to) work|get behind the wheel|do (?:your|a) shift)\b[^.!?\n]{0,30}?\b(?:(?:the )?(?:next|following) (?:day|morning)|(?:\d+|a few|a couple of|several|few|two|three|four|six|eight|twelve) hours? (?:after|later|on)|tomorrow|in the morning|the morning after|by morning)\b/i,
  },
];

/** Symptoms or low mood waved away as the body adjusting (round 4 red team), labelled "plays down a symptom". */
const PLAYDOWN_EXTRA: GateRule[] = [
  // "Those thoughts usually fade once you adjust", "those feelings tend to pass once your body adjusts".
  {
    re: /\b(?:thoughts|feelings|moods?|low mood|symptoms?|side[- ]effects?|effects?|urges|reactions?|sensations?)\b[^.!?\n]{0,30}?\b(?:fade|fades|pass|passes|lift|lifts|go away|goes away|settle|settles|ease|eases|wear off|wears off|disappear|disappears|subside|subsides|stop|stops)\b[^.!?\n]{0,20}?\b(?:once|as|when|after|while)\s+(?:you|your body|your system|he|she|they|his body|her body)\s+(?:(?:gets?|get|getting) used to|adjust|adjusts|settle|settles|settle in|adapt|adapts|get the hang|acclimati[sz]e)\b/i,
  },
  // "That's just your body getting used to it", "it's only your body adjusting".
  {
    re: /\b(?:just|only|simply|merely|probably just|probably only|likely just)\s+(?:your|his|her|their)\s+(?:body|system|brain)\s+(?:getting used to|adjusting|adapting|settling|acclimati[sz]ing|getting accustomed|finding its feet)\b|\b(?:your|his|her|their)\s+(?:body|system)\s+(?:is |['’]s )?(?:just |only |simply )?(?:getting used to|adjusting to|adapting to|settling into)\s+(?:it|them|the|this|your)\b/i,
  },
  // "Don't let a bit of nausea put you off", "don't let the headaches stop you".
  {
    re: new RegExp(
      String.raw`\b(?:don['’]?t|do not|dont|never)\s+let\s+(?:(?:a (?:bit|little) of|a little|a few|the|some|any|that|those|this|these|your|a|an|mild|slight)\s+)*(?:\w+\s+)?${SYMPTOM}\s+(?:put you off|stop you|get in (?:the|your) way|hold you back|scare you off|worry you|bother you|get to you)\b`,
      "i",
    ),
  },
];

/** A testimonial tied to a condition (round 4 red team): "Patients rave about it for their fibro". */
const TESTIMONIAL_EXTRA: GateRule[] = [
  {
    re: /\b(?:patients|people|customers|folks|everyone|users|clients|others)\b[^.!?\n]{0,20}?\b(?:rave|raves|raving|raved|rant|gush|gushes)\s+about\s+(?:it|them|this|these|those|the \w+|our \w+)\s+for\b|\b(?:love|loves|loving|adore|adores)\s+(?:it|them)\s+for\s+(?:their|the|his|her|my|your)\s+\w+|\bcan['’]?t get enough of (?:it|them)\b[^.!?\n]{0,15}?\bfor\b/i,
  },
];

/** A safety claim from other patients' experience (round 4 red team): "Nobody's ever had a problem with it". */
const SAFETY_CLAIMS_EXTRA: GateRule[] = [
  {
    re: /\b(?:nobody|no one|no-one|none of (?:our|my|the|them) (?:patients|customers|users|clients)?|not one (?:of our )?(?:patient|customer|person))(?:['’]s|['’]ve| has| have)?\s+(?:ever\s+)?(?:had|reported|complained (?:about|of)|mentioned|noticed|experienced|raised)\s+(?:a |any |an )?(?:\w+\s+)?(?:problems?|issues?|side[- ]effects?|reactions?|trouble|complaints?|concerns?)\s+(?:with|from|on|after)\s+(?:it|them|this|these|the (?:oil|capsules?|caps|gummies|spray|flower|product|tincture|drops|strain)|our (?:oil|capsules?|gummies|spray|flower|products?))\b(?!\s+(?:arriving|arrive|arrived|being|getting|turning|showing|coming|going|ship\w*|deliver\w*|dispatch\w*|late|on time|in the post|at the depot))|\b(?:nobody|no one|no-one|none of (?:our|my|the) (?:patients|customers|users))(?:['’]s|['’]ve| has| have)?\s+(?:ever\s+)?(?:had|reported|experienced|mentioned|complained (?:about|of))\s+(?:any\s+)?(?:\w+\s+)?(?:side[- ]effects?|adverse (?:effects?|reactions?)|bad reactions?|reactions?)\b/i,
  },
];

/**
 * Policy breaches that are not clinical but must never be sent: promising a deletion (P9.1), asking for or repeating
 * card details or a password (P5.1, P8.1), a refund to a different card (P5.3), a discount code (P5.4, there are none),
 * a redaction placeholder left in, and telling someone not on the account about the patient's care (P8.1, P11.1).
 */
const NEGATED_RE = /\b(?:never|don['’]?t|do not|dont|won['’]?t|will not|can['’]?t|cannot|can not|not|no longer|none)\b/i;
interface PolicyRule {
  label: string;
  re: RegExp;
  /** Skipped when the sentence says the opposite ("we never ask for your password"). */
  negatable?: boolean;
  /** Skipped when the sentence also matches this ("add your card under Billing in the app"). */
  unless?: RegExp;
  /** Report only the last 4 digits, so a card number is never shown back on screen. */
  mask?: boolean;
  /** Wording blanked out before the rule is tried, so the rest of the sentence is still checked. */
  blank?: RegExp;
}
/** A card number in any grouping: spaces, hyphens, dots or slashes ("4111.1111.1111.1111"). */
const CARD_NUMBER_RE = /(?<![\p{L}\p{N}_])[2-6](?:[ .\/-]{0,2}\d){12,18}(?!\d)/u;
const POLICY_RULES: PolicyRule[] = [
  {
    label: "promises a deletion",
    re: /\b(?:permanently|completely|fully|entirely)\s+(?:deleted|erased|wiped|removed|purged|destroyed|delete|erase|wipe|remove|purge)\b|\b(?:deleted|erased|wiped|removed|purged)\b[^.!?\n]{0,60}\b(?:from (?:our|all|the) (?:records|systems?|database|files)|all (?:of )?your (?:data|details|records|information))\b|\b(?:delete|erase|wipe|remove)\b[^.!?\n]{0,40}\bfrom (?:our|all) (?:records|systems?|database)\b/i,
    negatable: true,
  },
  {
    label: "asks for card details",
    re: /\b(?:reply|send|give|confirm|tell|provide|share|type|pop|email|text|read|enter|write|let (?:me|us) (?:have|know)|could you|can you|would you|need)\b[^.!?\n]{0,60}\b(?:card (?:number|no\.?|details|digits)|(?:long|full|16[- ]digit) (?:card )?number|expiry(?: date)?|exp(?:iration)? date|security code|CVV|CVC|CSC|CV2|3[- ]digit (?:code|number)|three[- ]digit (?:code|number)|(?:number|code) on the (?:front|back) of (?:your|the) card|(?:1[3-9]|long|all the|full)\s+digits|digits (?:on|of|from|across) (?:the (?:front|back) of )?(?:your|the) card|digits on the (?:front|back))\b/i,
    negatable: true,
    unless: /\b(?:billing|account settings|in the app|the app|portal|securely|yourself)\b/i,
  },
  { label: "repeats a card number", re: CARD_NUMBER_RE, mask: true },
  {
    label: "asks for a password",
    re: /\b(?:send|give|tell|share|confirm|reply with|type|email|text|provide|need|let (?:me|us) (?:have|know)|what(?:['’]s| is))\b[^.!?\n]{0,30}\b(?:your |the )?(?:password|passcode|pass code|PIN|login details|log-?in details|one[- ]time (?:code|passcode|password)|verification code|2FA code|security answer)\b/i,
    negatable: true,
    // "If you need a password reset, the link lasts 30 minutes" is the patient needing a reset, not us asking for
    // anything. Only "you need a/another/a new password reset (link or email)": "we need your password", "send us the
    // password reset link" and "a password reset code" are still blocked.
    blank: /(?<=\b(?:you|you['’]ll|you will|you ever|you still)\s+)need\s+(?:a|another|a new|a fresh)\s+password\s+reset(?:\s+(?:link|e-?mail))?\b(?!\s+(?:codes?|pins?|numbers?|tokens?|otps?|answers?))/gi,
  },
  {
    label: "refund to another card",
    re: /\brefund\w*\b[^.!?\n]{0,50}\b(?:new|different|other|another|second|replacement|updated)\s+(?:card|account|bank(?: account)?)\b|\b(?:new|different|another|other)\s+card\b[^.!?\n]{0,40}\brefund\w*/i,
    negatable: true,
  },
  {
    label: "discount code",
    re: /\b(?:discount|promo(?:tion(?:al)?)?|coupon|voucher|referral)\s+codes?\b[^.!?\n]{0,30}\b(?:applied|added|activated|redeemed|accepted|approved|is (?:on|valid|working)|works|will (?:take|give|save))\b|\b(?:applied|added|activated|redeemed)\s+(?:a|the|your)\s+(?:discount|promo|coupon|voucher)\b/i,
    negatable: true,
  },
  // "[NAME]" is left to the send gate's name filling (lib/format.ts), as older drafts greet with it.
  { label: "placeholder left in", re: /\[(?:EMAIL|PHONE|ADDRESS|DOB|HEALTH ID|CARD|REDACTED)\]/ },
  {
    label: "shares care details",
    re: /\b(?:told|tell|let|informed|explained to|mentioned (?:it )?to|said to|passed (?:it|this|that|on) (?:on )?to)\b[^.!?\n]{0,30}\b(?:neighbou?r|flatmate|housemate|landlord|landlady|boss|employer|colleague|workmate|friend|reception(?:ist)?|concierge|building manager|family)\b[^.!?\n]{0,50}\b(?:clinic|medicine|medication|prescription|treatment|cannabis|condition|oil|capsules?|spray|what (?:it|the parcel|the package|the call) (?:is|was)|from (?:us|the clinic|Dispensed))\b/i,
  },
];

/** Where a clause begins, for scoping a negation to the words it governs. */
const NEGATION_STOP_RE = /[,;:()]|\b(?:but|if|so|and|because|when|once|unless|though|although|while|whereas|or)\b/gi;
/** A conditional or reason clause set off by a comma: "If the app won't load,", "Since you can't log in,". */
const CONDITION_CLAUSE_RE = /\b(?:if|when|whenever|unless|since|because|as|until|once|while)\b[^,;:.!?\n]*[,;:]/gi;

/**
 * True when a negation governs the match: within six words before it in the same clause ("we will never ask you to
 * send your password"), or inside the match in the clause that names the detail ("reply with the order number, not
 * your card number"). A "won't" or "can't" in another clause ("if the app won't load, just reply with your card
 * number") does not count.
 */
function negatedNear(sentence: string, start: number, end: number): boolean {
  const before = sentence.slice(0, start);
  let cut = 0;
  for (const m of before.matchAll(NEGATION_STOP_RE)) cut = (m.index ?? 0) + m[0].length;
  const window = before.slice(cut).trim().split(/\s+/).slice(-6).join(" ");
  if (NEGATED_RE.test(window)) return true;
  const inside = sentence.slice(start, end);
  let icut = 0;
  // "or" joins alternatives inside one clause ("can't go to a new or different card"), so it does not cut here.
  for (const m of inside.matchAll(NEGATION_STOP_RE)) if (!/^or$/i.test(m[0])) icut = (m.index ?? 0) + m[0].length;
  return NEGATED_RE.test(inside.slice(icut));
}

function policyBreach(sentence: string): string | null {
  for (const rule of POLICY_RULES) {
    const s = rule.blank ? sentence.replace(rule.blank, (b) => " ".repeat(b.length)) : sentence;
    const m = rule.re.exec(s);
    if (!m || m.index === undefined) continue;
    if (rule.negatable && negatedNear(s, m.index, m.index + m[0].length)) continue;
    if (rule.unless && rule.unless.test(s.replace(CONDITION_CLAUSE_RE, (c) => " ".repeat(c.length)))) continue;
    const shown = rule.mask ? `ending ${m[0].replace(/\D/g, "").slice(-4)}` : m[0].trim();
    return `${rule.label}: ${shown}`;
  }
  return null;
}

/** The first match of any rule, with its excuse checked. */
function firstGateMatch(
  rules: (GateRule & { needsMed?: boolean })[],
  sentence: string,
  excused: Excuse = NO_EXCUSE,
  planExcused: Excuse = NO_EXCUSE,
): string | null {
  for (const rule of rules) {
    if (rule.needsMed && !STRAIN_OR_MED_RE.test(sentence)) continue;
    for (const [text, start, end] of allMatches(rule.re, sentence)) {
      if (rule.handoverOk && excused(start, end)) continue;
      if (rule.planOk && planExcused(start, end)) continue;
      const where = rule.scope === "sentence" ? sentence : clauseAt(sentence, start, end);
      if (rule.scope && NOT_DOSE_RE.test(where) && !MED_WORD_RE.test(where)) continue;
      if (rule.bookingOk && bookingMoveExcused(sentence, end, clauseAt(sentence, start, end))) continue;
      if (rule.needsUse && !(USE_VERB_RE.test(where) || MED_WORD_RE.test(where) || PRONOUN_RE.test(where))) continue;
      return text;
    }
  }
  return null;
}

interface Sentence {
  text: string;
  start: number;
  end: number;
}
function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?\n]+[.!?]*/g;
  for (const m of text.matchAll(re)) {
    if (m.index === undefined || !m[0].trim()) continue;
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Clinical words from the patient-message lexicon in one sentence, minus the ones about billing or the app: side
 * effects, clinical questions, and the adverse-event words that also have an everyday sense ("we've had more than
 * usual", "unable to speak to your bank"), which count only outside a billing, delivery or app clause.
 */
function clinicalWords(sentence: string, hits: RuleHit[]): [string, number, number][] {
  const billing = BILLING_RE.test(sentence);
  const words = hits
    .filter(
      (h) =>
        CLINICAL_CATEGORIES.has(h.category) ||
        (h.category === "adverse_event" &&
          !SERIOUS_RULES.has(h.ruleId) &&
          h.ruleId !== LIVING_PATIENT_RULE_ID &&
          !NOT_DOSE_RE.test(clauseAt(sentence, h.start, h.end)) &&
          // "We've had more than usual demand" is not about the medicine; "taking more than prescribed" is.
          !(h.ruleId === "adverse.more_than" && !OVERUSE_WORD_RE.test(h.phrase) && !MED_WORD_RE.test(sentence))),
    )
    // "Your parcel is safe with the neighbour", "it's safe with us": about a parcel or their details.
    .filter((h) => !(h.ruleId === "clinical.mix_with" && /^safe\s/i.test(h.phrase) && (SAFE_WITH_ROUTINE_RE.test(sentence.slice(h.end)) || NOT_DOSE_RE.test(clauseAt(sentence, h.start, h.end)))))
    .filter((h) => !(billing && /\b(?:amount|double|charge)\b/i.test(h.phrase)))
    // "It's safe to delete the old app", "it's safe to throw away the packaging": an app or account step.
    .filter((h) => !(/\bsafe\s+to$/i.test(h.phrase.trim()) && SAFE_TO_ROUTINE_RE.test(sentence.slice(h.end))))
    // "If you're driving down on Saturday and the courier misses you": a trip, not driving on the medicine.
    .filter((h) => !(DRIVING_RE.test(h.phrase) && NOT_PATIENT_DRIVING_RE.test(sentence) && !MED_WORD_RE.test(sentence)))
    .filter((h) => !NOT_MEDICINE_AFTER.test(sentence.slice(h.end)))
    .filter((h) => !GENERIC_MEDICINE_RE.test(h.phrase.trim()))
    .map((h): [string, number, number] => [h.phrase.trim(), h.start, h.end]);
  if (words.length === 0 && !NOT_PATIENT_DRIVING_RE.test(sentence)) words.push(...allMatches(DRIVING_RE, sentence));
  if (words.length === 0) words.push(...allMatches(STOPPING_RE, sentence));
  return words;
}

/** Broad sentence-level gate. Returns banned entries for sentences no earlier rule already reported. */
function findClinical(text: string, reported: [number, number][]): string[] {
  const out: string[] = [];
  const all = sentencesOf(text);
  all.forEach((s, i) => {
    if (reported.some(([a, b]) => a < s.end && b > s.start)) return;
    const t = s.text;
    let hit: string | null = null;
    let label = "clinical advice";
    const previous = i > 0 ? all[i - 1].text : "";
    // "Pause it" where "it" is the plan, not the medicine (checked per match, so "pause it, and stop the oil" still blocks).
    const planExcused: Excuse = (a, b) => pronounIsPlan(previous, t, a, t.slice(a, b));
    for (const re of INSTRUCTION_RULES) {
      for (const [mt, ms, me] of allMatches(re, t)) {
        // Policy for a wrong or damaged item asks the patient not to use it until a pharmacist has been in touch.
        const around = all.slice(Math.max(0, i - 1), i + 2).map((x) => x.text).join(" ");
        if (/\b(?:don['’]?t|do not|dont)\s+use\b/i.test(mt) && WRONG_ITEM_RE.test(around)) continue;
        // "Pause it for 1 to 3 months" about the plan; "we will pass your request to drop the capsules to a clinician";
        // "your separate request to drop the capsules from your plan".
        if (planExcused(ms, me) || requestPassedToClinician(t, ms, me) || requestToDropFromPlan(t, ms, me)) continue;
        // "If you miss it, Courierline holds the parcel at the depot": the delivery, not a dose.
        if (re === INSTRUCTION_RULES[0] && missIsDelivery(previous, t, mt)) continue;
        hit = mt;
        break;
      }
      if (hit) break;
    }
    // The same sentence with everyday idioms blanked out ("such a headache"), so indices still line up.
    const plain = withoutIdioms(t);
    // "The box collapsed", "the hospital mailroom": an adverse word about a thing or an address, not a person.
    const aboutThing = (h: RuleHit) => {
      const clause = clauseAt(plain, h.start, h.end);
      if (/collaps|\bfell\b|\bfall/i.test(h.phrase) && THING_RE.test(clause)) return true;
      return h.category === "adverse_event" && NOT_DOSE_RE.test(clause) && !MED_WORD_RE.test(clause) && !SYMPTOM_WIDE_RE.test(clause);
    };
    const hits = checkRules(plain).hits.filter((h) => !aboutThing(h));
    const dismisses = DISMISS_RE.test(plain) || (KEEP_EYE_RE.test(plain) && !keepEyeOnParcel(plain, hits));
    const normalises = NORMALISE_RE.test(plain);
    const seriousWide = SERIOUS_WIDE_RE.exec(plain)?.[0];
    const symptomNamed =
      !!seriousWide || SYMPTOM_WIDE_RE.test(plain) || hits.some((h) => h.category === "side_effect" || h.category === "adverse_event");
    // Sending a symptom to the patient's own GP is a triage call, not a hand-over to our clinician (P10.1).
    const externalReferral = EXTERNAL_REFERRAL_RE.exec(plain);
    // A hand-over excuses only the words in its own clause, and never a sentence that also gives a verdict or plays a
    // symptom down ("our clinician is happy for you to drink alcohol", "a clinician will call, but it's likely nothing").
    const handoverOk =
      (HANDOVER_RE.test(plain) || EMERGENCY_RE.test(plain)) &&
      !VERDICT_RE.test(plain) &&
      !dismisses &&
      !normalises &&
      !(externalReferral && symptomNamed && !EMERGENCY_RE.test(plain));
    const handoverSpans = handoverOk ? handoverClauses(plain) : [];
    const excused: Excuse = (a, b) => handoverSpans.some(([x, y]) => a >= x && b <= y);
    // Dosing words that a hand-over may name ("a clinician will talk you through how much to take") are also excused in
    // a clause that only says support cannot advise ("we can't advise on how much to take, so a clinician will reply").
    const dosingExcused: Excuse = (a, b) =>
      excused(a, b) ||
      (handoverSpans.length > 0 && clauseSpans(plain).some(([x, y]) => a >= x && b <= y && NEGATED_RE.test(plain.slice(x, a))));
    if (!hit && externalReferral && symptomNamed && !EMERGENCY_RE.test(plain)) {
      hit = externalReferral[0];
      label = "clinical advice";
    }
    if (!hit) {
      const dose = firstGateMatch(DOSING_ADVICE, t, dosingExcused, planExcused);
      if (dose) {
        hit = dose;
        label = "dosing advice";
      }
    }
    if (!hit) {
      // Crisis or low-mood language in any person: a crisis message never gets a drafted reply (P10.2 to P10.4).
      const crisis = firstUnexcused(CRISIS_WORDS_RE, plain, excused);
      if (crisis) {
        hit = crisis;
        label = "crisis language";
      }
    }
    if (!hit && DISMISS_ALWAYS_RE.test(plain) && !(NOT_DOSE_RE.test(plain) && !MED_WORD_RE.test(plain) && !symptomNamed)) {
      // "He should be right once he sleeps it off", "you just need more water and a good lie down".
      hit = t.trim().replace(/[.!?]+$/, "");
      label = "plays down a symptom";
    }
    // The symptom a dismissal or a normalising phrase would be about, if any.
    const namedSymptom =
      hits.find(
        (h) =>
          h.category === "side_effect" ||
          (h.category === "adverse_event" && h.ruleId !== LIVING_PATIENT_RULE_ID) ||
          // Any crisis word being played down ("thoughts of ending things are common"), idioms aside.
          (h.category === "crisis" && !CRISIS_IDIOMS.has(h.ruleId)) ||
          SERIOUS_RULES.has(h.ruleId),
      )?.phrase ??
      seriousWide ??
      SYMPTOM_WIDE_RE.exec(plain)?.[0];
    if (!hit && dismisses) {
      // A symptom waved away: "don't worry about the headaches", "the chest pain is probably nothing", "ignore the rash".
      if (namedSymptom) {
        hit = t.trim().replace(/[.!?]+$/, "");
        label = "plays down a symptom";
      } else if (KEEP_EYE_RE.test(plain) && (namesMedicine(plain) || KEEP_EYE_EFFECT_RE.test(plain))) {
        // "Keep an eye on how the oil makes you feel until the parcel arrives", "keep an eye on the parcel and how you
        // feel": watching the medicine's effect is a clinician's call, even with a parcel named and no symptom word.
        // "Keep an eye on your oil order" alone is only the order.
        hit = t.trim().replace(/[.!?]+$/, "");
        label = "clinical advice";
      } else if (VERDICT_ONLY_RE.test(plain) && !NOT_DOSE_RE.test(plain)) {
        // "That's normal." "It will pass." With no order, parcel or payment named, it answers what the patient felt.
        hit = t.trim().replace(/[.!?]+$/, "");
        label = "plays down a symptom";
      }
    }
    if (!hit) {
      // A serious symptom or crisis word, whatever surrounds it: only a clinician replies about it.
      const serious =
        hits.find((h) => SERIOUS_RULES.has(h.ruleId) && !excused(h.start, h.end))?.phrase ?? firstUnexcused(SERIOUS_WIDE_RE, plain, excused);
      if (serious) {
        hit = serious;
        label = "serious symptom";
      }
    }
    if (!hit) {
      const words = clinicalWords(plain, hits).filter(([, a, b]) => !excused(a, b));
      if (words.length > 0) {
        const context = MED_WORD_RE.test(t) || PRONOUN_RE.test(t) || USE_VERB_RE.test(t) || VERDICT_RE.test(t) || dismisses;
        if (context) hit = words[0][0];
      }
    }
    if (!hit && normalises && namedSymptom) {
      // A symptom made to sound ordinary: "night sweats are a known effect", "lots of patients feel a bit dizzy".
      hit = t.trim().replace(/[.!?]+$/, "");
      label = "plays down a symptom";
    }
    if (!hit) {
      // Another medicine, a supplement, alcohol, pregnancy or breastfeeding: always a clinician's topic. A hand-over
      // clause excuses naming one, but not recommending it ("your GP can prescribe you melatonin").
      const other = [...allMatches(OTHER_MEDICINE_RE, plain), ...allMatches(CLINICAL_TOPIC_RE, plain)].find(
        ([, a, b]) => !excused(a, b) || RECOMMEND_BEFORE_RE.test(plain.slice(Math.max(0, a - 40), a)),
      );
      if (other) hit = other[0];
    }
    if (!hit) {
      const act = firstGateMatch(CLINICAL_ACTS, t, excused) ?? firstGateMatch(CLINICAL_ACTS_EXTRA, t);
      if (act) hit = act;
    }
    if (!hit) {
      const playdown = firstGateMatch(PLAYDOWN_EXTRA, t);
      if (playdown) {
        hit = t.trim().replace(/[.!?]+$/, "");
        label = "plays down a symptom";
      }
    }
    if (!hit) {
      const claim = firstGateMatch(SAFETY_CLAIMS, t) ?? firstGateMatch(SAFETY_CLAIMS_EXTRA, t);
      if (claim) {
        hit = claim;
        label = "safety or addiction claim";
      }
    }
    if (!hit) {
      for (const re of CLAIM_RULES) {
        re.lastIndex = 0;
        const m = re.exec(t);
        if (m && !(re === CLAIM_RULES[2] && effectIsNotMedicine(t))) {
          hit = m[0];
          label = "product claim";
          break;
        }
      }
    }
    if (!hit) {
      const claim = firstGateMatch(PRODUCT_CLAIMS, t) ?? firstGateMatch(TESTIMONIAL_EXTRA, t);
      if (claim) {
        hit = claim;
        label = "product claim";
      }
    }
    if (!hit && CONDITION_RE.test(t) && (POPULATION_OUTCOME_RE.test(t) || RESULTS_RE.test(t))) {
      // "Most patients sleep better from the first night", "people with arthritis tend to get great results": an outcome
      // promised through other patients, with no medicine word needed.
      hit = t.trim().replace(/[.!?]+$/, "");
      label = "product claim";
    }
    if (!hit && CLAIM_SUBJECT_RE.test(t) && CLAIM_VERB_RE.test(t)) {
      const c = CONDITION_RE.exec(t);
      if (c) {
        hit = t.trim().replace(/[.!?]+$/, "");
        label = "product claim";
      }
    }
    if (hit) {
      reported.push([s.start, s.end]);
      out.push(`${label}: ${hit.trim()}`);
      return;
    }
    // Not clinical, but never allowed: a card or password request, a deletion promise, a placeholder and so on.
    const breach = policyBreach(t);
    if (breach) {
      reported.push([s.start, s.end]);
      out.push(breach);
    }
  });
  return out;
}

/** Banned-entry labels that mean the reply strays into clinical territory, so the right move is a clinician. */
const CLINICAL_LABELS = [
  "medical advice",
  "dosing figure",
  "dosing advice",
  "clinical advice",
  "plays down a symptom",
  "serious symptom",
  "crisis language",
  "safety or addiction claim",
  "product claim",
];

/** Why each clinical label needs a clinician, most serious first. Read by an agent next to a switched-off Send. */
const CLINICIAN_REASONS: [string[], string][] = [
  [["crisis language"], "This touches on crisis or low-mood language. Only a person using the urgent template replies, and a clinician makes contact: escalate it to a clinician."],
  [["serious symptom"], "This mentions a serious symptom. Only a clinician replies about it: escalate it to a clinician."],
  [["plays down a symptom"], "This plays down a symptom. Only a clinician can judge it: escalate it to a clinician."],
  [["medical advice", "dosing figure", "dosing advice", "clinical advice"], "This reads as clinical advice: escalate it to a clinician."],
  [["safety or addiction claim"], "Claims about safety or addiction are for a clinician: escalate it to a clinician."],
  [["product claim"], "Claims about what the product does are for a clinician."],
];

/**
 * Why a check result needs a clinician rather than a rewrite, in plain words, or null when nothing clinical was
 * blocked. For the edit path: when this returns a reason, Send stays off and the UI offers "Escalate to a clinician".
 */
export function clinicianReason(result: Pick<CheckResult, "banned"> | null | undefined): string | null {
  const banned = result?.banned ?? [];
  const labels = new Set(banned.map((b) => b.slice(0, b.indexOf(":"))));
  for (const [group, reason] of CLINICIAN_REASONS) if (group.some((l) => labels.has(l))) return reason;
  return null;
}

/** Why each non-clinical policy block can never be sent, in plain words. */
const POLICY_REASONS: [string, string][] = [
  ["repeats a card number", "Never write a card number in a reply. Card details only go in under Billing in the app."],
  ["asks for card details", "Support never takes card details by chat or email. Point the patient to Billing in the app."],
  ["asks for a password", "Never ask for a password or a code. Point the patient to the newest reset link."],
  ["refund to another card", "Refunds only go back to the original card."],
  ["discount code", "There are no discount codes, so none can be applied."],
  ["promises a deletion", "Deletion requests go to the privacy officer, and nobody promises a full deletion."],
  ["shares care details", "Nothing about the patient's care is shared with someone not listed on the account."],
  ["placeholder left in", "A hidden detail placeholder is still in the reply. Write the words out or take it out."],
];

/**
 * Why a check result is blocked for a non-clinical policy reason, in plain words, or null when none applies. For the
 * edit path: the agent can rewrite these; nothing needs a clinician.
 */
export function policyReason(result: Pick<CheckResult, "banned"> | null | undefined): string | null {
  const banned = result?.banned ?? [];
  for (const [label, reason] of POLICY_REASONS) if (banned.some((b) => b.startsWith(`${label}:`))) return reason;
  return null;
}

/** True for a banned entry that is clinical (advice, dosing or a product claim). */
export function isClinicalBan(entry: string): boolean {
  return CLINICAL_LABELS.some((l) => entry.startsWith(`${l}:`));
}

const DASH_CHARS: [string, string][] = [
  ["\u2012", "U+2012 figure dash"],
  ["\u2013", "U+2013 en dash"],
  ["\u2014", "U+2014 em dash"],
  ["\u2015", "U+2015 horizontal bar"],
];

function findBanned(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const key = s.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  };
  const reported: [number, number][] = [];
  for (const rule of BANNED_RULES) {
    for (const m of text.matchAll(rule.re)) {
      if (m.index === undefined) continue;
      const part = rule.group ? m[rule.group] : m[0];
      if (!part) continue;
      const start = m.index + (rule.group ? m[0].lastIndexOf(part) : 0);
      const end = start + part.length;
      // One report per stretch of text, so "take 10 mg" is not listed three times.
      if (reported.some(([a, b]) => start < b && end > a)) continue;
      reported.push([start, end]);
      push(`${rule.label}: ${part.trim()}`);
      // "It works wonders for nerve pain": promotion tied to a condition is also a claim about what the product does,
      // which only a clinician answers, so the desk offers an escalation rather than a rewrite.
      if (rule.label === "promotional wording") {
        const sentence = sentenceAt(text, start, end);
        if (CONDITION_RE.test(sentence)) push(`product claim: ${sentence.trim().replace(/[.!?]+$/, "")}`);
      }
    }
  }
  for (const entry of findClinical(text, reported)) push(entry);
  // A card number written with dots is split into "sentences" at each dot, so it is also looked for in the whole text.
  const card = CARD_NUMBER_RE.exec(text);
  if (card && !out.some((b) => b.startsWith("repeats a card number:"))) push(`repeats a card number: ending ${card[0].replace(/\D/g, "").slice(-4)}`);
  for (const [ch, name] of DASH_CHARS) if (text.includes(ch)) push(`dash character: ${name}`);
  return out;
}

// ---------- facts the patient stated ----------

/** The sourceId of a fact that only the patient's own message holds (a date or time they asked for). */
export const PATIENT_MESSAGE_ID = "PATIENT_MESSAGE";

/** Fact kinds that may come from the patient's own message: dates, weekdays, times and time frames. Never money or ids. */
const PATIENT_KINDS: ReadonlySet<FactKind> = new Set<FactKind>(["date", "time", "duration"]);

/**
 * A sentence about money, a refund or an approval. A figure in it must be in the sources, even when the patient wrote
 * it ("you promised my refund by 17 October", "my doctor approved it on the 3rd"): the patient's word is not a source.
 */
const MONEY_OR_APPROVAL_RE =
  /\b(?:refund\w*|credit\w*|reimburs\w*|compensat\w*|waiv\w*|approv\w*|goodwill|discount\w*|charg\w*|bill\w*|pay|paid|payments?|pric\w*|fees?|costs?|money|owe[ds]?|owing|vouchers?|invoic\w*|concession\w*)\b|[$£€]|\b(?:AUD|NZD|GBP|USD|EUR)\b/i;
/** A refund, credit or approval sentence: no amount in it may be worked out from two others. */
const REFUND_OR_APPROVAL_RE =
  /\b(?:refund\w*|credit\w*|reimburs\w*|compensat\w*|waiv\w*|approv\w*|goodwill|discount\w*|money back|back (?:on|to) (?:your|the) card|pay (?:you|it) back|owe[ds]?|owing|vouchers?)\b/i;

/** Lower case, one space, straight apostrophes: for a word-for-word comparison. */
function flat(s: string): string {
  return s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}
/** True when `phrase` appears word for word in `text` (case and spacing aside), as whole words. */
function verbatim(phrase: string, text: string): boolean {
  const p = flat(phrase);
  if (!p) return false;
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRe(p)}(?![\p{L}\p{N}])`, "u").test(flat(text));
}

/**
 * An hour the patient wrote without am or pm, after a time word: "anything after 6", "any time after 5 that day",
 * "before 9:30". Not "after 5 days", "at 3 months", "by the 30th" or a range start ("from 2 to 5").
 */
const BARE_HOUR_RE =
  /\b(?:after|before|at|by|from|until|till|til|around|about|past)\s+(\d{1,2})(?:[:.]([0-5]\d))?(?:\s*o['’]?clock)?(?![\d:./%-]|\s*(?:to\b|-|st\b|nd\b|rd\b|th\b|(?:minutes?|mins?|hours?|hrs?|days?|nights?|weeks?|months?|years?|business|working|calendar|am|pm|a\.m|p\.m)(?![a-z])))/gi;

function sameDateNorm(a: Extract<Norm, { kind: "date" }>, b: Norm): boolean {
  if (b.kind !== "date") return false;
  const pairs = [{ d: a.d, m: a.m }, ...(a.alt ? [a.alt] : [])];
  const others = [{ d: b.d, m: b.m }, ...(b.alt ? [b.alt] : [])];
  return pairs.some((x) => others.some((y) => x.d === y.d && x.m === y.m)) && (a.y === undefined || b.y === undefined || a.y === b.y);
}

/**
 * True when a draft fact the sources do not hold is one the patient wrote in their own message: the same date, weekday,
 * time or time frame, written word for word (a time also when the patient gave the bare hour: "anything after 6").
 * Never in a sentence about money, a refund or an approval.
 */
function statedByPatient(f: Fact, draft: string, patientText: string, patientFacts: Fact[]): boolean {
  if (!PATIENT_KINDS.has(f.kind)) return false;
  if (MONEY_OR_APPROVAL_RE.test(sentenceAt(draft, f.start, f.end))) return false;
  const n = f.norm;
  switch (n.kind) {
    case "date":
      return patientFacts.some((p) => sameDateNorm(n, p.norm)) && verbatim(f.text, patientText);
    case "reldate":
      // "on Thursday", "tomorrow", "next Friday": the words themselves, without the "on".
      return verbatim(f.text.replace(/^on\s+/i, ""), patientText);
    case "duration":
      return (
        patientFacts.some((p) => p.norm.kind === "duration" && p.norm.lo === n.lo && p.norm.hi === n.hi && p.norm.unit === n.unit) &&
        verbatim(f.text.replace(/^(?:within|in|about|around|up to|under|over|another|next)\s+/i, ""), patientText)
      );
    case "time": {
      if (patientFacts.some((p) => p.norm.kind === "time" && p.norm.minutes === n.minutes)) return true;
      const hour = Math.floor(n.minutes / 60) % 12;
      const minute = n.minutes % 60;
      for (const m of patientText.matchAll(BARE_HOUR_RE)) {
        const h = +m[1];
        if (h >= 1 && h <= 12 && h % 12 === hour && (m[2] ? +m[2] : 0) === minute) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

interface CitedAmount {
  fact: Fact;
  sourceId?: string;
  value: number;
  currency: string | null;
}

/**
 * An amount that is the difference or the sum of two amounts the draft writes and the sources hold ("the extra $13"
 * for NZ$162 against NZ$149). Never in a refund, credit or approval sentence.
 */
function derivedAmount(f: Fact, draft: string, cited: CitedAmount[], patientCurrency: Currency | null): { working: string; sourceId?: string } | null {
  if (f.norm.kind !== "amount") return null;
  const { value, currency } = f.norm;
  if (!fitsPatient(currency, patientCurrency)) return null;
  if (REFUND_OR_APPROVAL_RE.test(sentenceAt(draft, f.start, f.end))) return null;
  for (let i = 0; i < cited.length; i++) {
    for (let j = i + 1; j < cited.length; j++) {
      const [a, b] = cited[i].value >= cited[j].value ? [cited[i], cited[j]] : [cited[j], cited[i]];
      if (!sameCurrency(a.currency, b.currency) || !sameCurrency(currency, a.currency) || !sameCurrency(currency, b.currency)) continue;
      if (a.value - b.value > 0.005 && Math.abs(a.value - b.value - value) < 0.005) {
        return { working: `${a.fact.text} minus ${b.fact.text}`, sourceId: a.sourceId };
      }
      if (Math.abs(a.value + b.value - value) < 0.005) return { working: `${a.fact.text} plus ${b.fact.text}`, sourceId: a.sourceId };
    }
  }
  return null;
}

// ---------- main ----------

/**
 * Check a draft against its sources. `opts.today` (ISO date, default DEMO_TODAY) resolves relative dates such as
 * "tomorrow" or "next Friday"; it is passed in, never read from a clock, so results are reproducible.
 * `opts.currency` is the patient's currency; when it is left out it is read from the patient's records in `sources`.
 * An amount in another currency ("£112" for an Australian patient) is never found, even when a policy lists it.
 *
 * `opts.patientText` is the patient's redacted message. A date, weekday, time or time frame the sources do not hold but
 * the patient wrote word for word ("could we move it to Wednesday 11 November?") is marked found with sourceId
 * PATIENT_MESSAGE and `fromPatient: true`, for the agent to check first. Money, refund and approval figures never take
 * that path. An amount that is the difference or sum of two amounts the draft cites is found, with `derivedFrom`.
 */
export function checkDraft(
  text: string,
  sources: SourceRef[],
  opts: { today?: string; currency?: Currency; patientText?: string } = {},
): CheckResult {
  const draft = text ?? "";
  const today = parseToday(opts.today ?? DEMO_TODAY);
  const banned = findBanned(draft);
  const sourceFacts: SourceFacts[] = (sources ?? []).map((source) => ({
    source,
    lower: `${source.id} ${source.label ?? ""} ${source.text ?? ""}`.toLowerCase(),
    facts: extractFacts(`${source.label ?? ""}\n${source.text ?? ""}`, today).map((f) => f.norm),
  }));
  const currency = patientCurrencyOf(sourceFacts, opts.currency);
  const patientText = opts.patientText ?? "";
  const patientFacts = patientText.trim() ? extractFacts(patientText, today) : [];

  const rows: { fact: Fact; check: FactCheck }[] = [];
  const seen = new Set<string>();
  for (const f of extractFacts(draft, today)) {
    // A weekday in a range and the same weekday on its own ("Monday to Friday ... it will arrive Friday"), or a lateness
    // figure and the same figure as a promise, are checked apart: one never stands in for the other.
    const n = f.norm;
    const variant = n.kind === "reldate" && n.range ? ":range" : n.kind === "duration" && n.late ? ":late" : "";
    const key = `${f.kind}:${f.text.toLowerCase()}${variant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Prefer the source whose id is the fact itself ("ORD-20481"), then the first source that contains it.
    const byId = f.norm.kind === "literal" ? sourceFacts.find((s) => s.source.id.toUpperCase() === (f.norm as { value: string }).value) : undefined;
    const hit = byId ?? sourceFacts.find((s) => matches(f.norm, s, currency));
    rows.push({ fact: f, check: hit ? { text: f.text, kind: f.kind, found: true, sourceId: hit.source.id } : { text: f.text, kind: f.kind, found: false } });
  }

  // Amounts worked out from two cited ones, then the dates and times only the patient wrote.
  const cited: CitedAmount[] = [];
  for (const r of rows) {
    if (r.check.found && r.fact.norm.kind === "amount") {
      cited.push({ fact: r.fact, sourceId: r.check.sourceId, value: r.fact.norm.value, currency: r.fact.norm.currency });
    }
  }
  for (const r of rows) {
    if (r.check.found) continue;
    const derived = derivedAmount(r.fact, draft, cited, currency);
    if (derived) {
      r.check = { text: r.fact.text, kind: r.fact.kind, found: true, ...(derived.sourceId ? { sourceId: derived.sourceId } : {}), derivedFrom: derived.working };
    } else if (patientText.trim() && statedByPatient(r.fact, draft, patientText, patientFacts)) {
      r.check = { text: r.fact.text, kind: r.fact.kind, found: true, sourceId: PATIENT_MESSAGE_ID, fromPatient: true };
    }
  }

  const facts = rows.map((r) => r.check);
  const fromPatient = facts.filter((f) => f.fromPatient).length;
  return {
    facts,
    banned,
    passed: facts.every((f) => f.found) && banned.length === 0,
    ...(fromPatient > 0 ? { checkFirst: fromPatient } : {}),
  };
}

/** Plain-words summary for the trail ("6 facts checked, all found" / "1 of 5 facts not in the sources"). */
export function summariseCheck(result: CheckResult): string {
  const missing = result.facts.filter((f) => !f.found).length;
  const n = result.facts.length;
  const parts: string[] = [];
  const fromPatient = result.facts.filter((f) => f.fromPatient).length;
  if (n === 0) parts.push("No dates, amounts or order numbers to check");
  else if (missing === 0 && fromPatient > 0) {
    parts.push(
      `${n} ${n === 1 ? "fact" : "facts"} checked: ${n - fromPatient} found in the sources, ${fromPatient} from the patient's own message (check first)`,
    );
  } else if (missing === 0) parts.push(`${n} ${n === 1 ? "fact" : "facts"} checked, all found in the sources`);
  else parts.push(`${missing} of ${n} ${n === 1 ? "fact" : "facts"} not found in the sources`);
  if (result.banned.length > 0) parts.push(`${result.banned.length} blocked ${result.banned.length === 1 ? "phrase" : "phrases"}`);
  return parts.join("; ");
}
