/**
 * Formatting helpers for Care Desk. Pure functions: safe in Node 24, the browser and a Cloudflare Worker.
 *
 * Output is built by hand from numeric Intl parts (never from Intl's month or zone names), so the text is
 * identical on the server and in every browser. That keeps static pages free of hydration mismatches.
 * No dashes: ranges use "to", times use "9:42 am".
 */
import type { Category, Country, Currency, Risk, Route, StepId, StepStatus, SourceKind, RedactionType, FactKind } from "@/lib/types";

/** The demo's "now": Wednesday 23 September 2026, 9 pm in Melbourne, 11 pm in Auckland, midday in London. */
export const DEMO_NOW = "2026-09-23T11:00:00Z";
export const DEMO_NOW_MS = Date.parse(DEMO_NOW);

// ---------- Countries ----------

export const COUNTRY_LABEL: Record<Country, string> = {
  AU: "Australia",
  NZ: "New Zealand",
  UK: "United Kingdom",
};

export const COUNTRY_SHORT: Record<Country, string> = { AU: "AU", NZ: "NZ", UK: "UK" };

export const COUNTRY_CURRENCY: Record<Country, Currency> = { AU: "AUD", NZ: "NZD", UK: "GBP" };

export function countryLabel(country: Country): string {
  return COUNTRY_LABEL[country];
}

// ---------- Money ----------

const CURRENCY_SYMBOL: Record<Currency, string> = { AUD: "$", NZD: "$", GBP: "£" };
const CURRENCY_EXPLICIT: Record<Currency, string> = { AUD: "A$", NZD: "NZ$", GBP: "£" };

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * formatMoney(129, "NZD") -> "$129.00"; formatMoney(129, "NZD", { explicit: true }) -> "NZ$129.00".
 * Use explicit on the shared desk, where agents see all three countries side by side.
 * Negative amounts (refunds) render as "-$20.00" with a plain minus.
 */
export function formatMoney(
  amount: number,
  currency: Currency,
  opts: { explicit?: boolean; decimals?: 0 | 2 } = {},
): string {
  const decimals = opts.decimals ?? 2;
  const symbol = opts.explicit ? CURRENCY_EXPLICIT[currency] : CURRENCY_SYMBOL[currency];
  const abs = Math.abs(amount);
  const fixed = abs.toFixed(decimals);
  const [i, d] = fixed.split(".");
  const body = groupThousands(i) + (d ? "." + d : "");
  return (amount < 0 ? "-" : "") + symbol + body;
}

/** Currency by country: formatMoneyForCountry(49, "UK") -> "£49.00". */
export function formatMoneyForCountry(amount: number, country: Country, opts: { explicit?: boolean } = {}): string {
  return formatMoney(amount, COUNTRY_CURRENCY[country], opts);
}

/** US dollars for AI cost: 0.0041 -> "US$0.0041", 1.2 -> "US$1.20". */
export function formatUsd(amount: number): string {
  if (amount === 0) return "US$0";
  if (Math.abs(amount) < 0.01) return "US$" + amount.toFixed(4);
  if (Math.abs(amount) < 0.1) return "US$" + amount.toFixed(3);
  return "US$" + amount.toFixed(2);
}

// ---------- Dates and times ----------

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number; // 0..23
  minute: number;
  weekday: number; // 0 = Sunday
  offsetMinutes: number; // e.g. 600 for UTC+10
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function numericFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

function toMs(input: string | number | Date): number {
  if (typeof input === "number") return input;
  if (input instanceof Date) return input.getTime();
  // Plain ISO dates ("2026-09-24") are calendar dates, not instants: pin them to midday UTC so any zone keeps the day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return Date.parse(input + "T12:00:00Z");
  return Date.parse(input);
}

/** Wall-clock parts of an instant in an IANA timezone. */
export function zonedParts(input: string | number | Date, timeZone: string): ZonedParts {
  const ms = toMs(input);
  const parts = numericFormatter(timeZone).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour") % 24;
  const minute = get("minute");
  const second = get("second");
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, weekday, offsetMinutes };
}

const ZONE_ABBR: Record<string, Record<number, string>> = {
  "Australia/Sydney": { 600: "AEST", 660: "AEDT" },
  "Australia/Melbourne": { 600: "AEST", 660: "AEDT" },
  "Australia/Canberra": { 600: "AEST", 660: "AEDT" },
  "Australia/Hobart": { 600: "AEST", 660: "AEDT" },
  "Australia/Brisbane": { 600: "AEST" },
  "Australia/Adelaide": { 570: "ACST", 630: "ACDT" },
  "Australia/Darwin": { 570: "ACST" },
  "Australia/Perth": { 480: "AWST" },
  "Pacific/Auckland": { 720: "NZST", 780: "NZDT" },
  "Europe/London": { 0: "GMT", 60: "BST" },
};

/** "AEST", "NZST", "BST", or "UTC+10" when unknown. */
export function zoneAbbr(input: string | number | Date, timeZone: string): string {
  const { offsetMinutes } = zonedParts(input, timeZone);
  const known = ZONE_ABBR[timeZone]?.[offsetMinutes];
  if (known) return known;
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return "UTC" + sign + h + (m ? ":" + String(m).padStart(2, "0") : "");
}

/** "9:42 am" */
export function formatClock(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

export type DateStyle =
  | "day" // 23 Sep 2026
  | "dayShort" // 23 Sep
  | "dayLong" // Wednesday 23 September 2026
  | "weekday" // Wed 23 Sep
  | "time" // 9:42 am
  | "dateTime" // Wed 23 Sep, 9:42 am
  | "dateTimeZone"; // Wed 23 Sep, 9:42 am AEST

/**
 * Dates in the patient's timezone. formatDate("2026-09-23T10:32:00Z", "Australia/Melbourne", "dateTimeZone")
 * -> "Wed 23 Sep, 8:32 pm AEST". Plain ISO dates ("2026-09-24") keep their calendar day.
 */
export function formatDate(input: string | number | Date, timeZone: string, style: DateStyle = "day"): string {
  const p = zonedParts(input, timeZone);
  const mon = MONTHS_SHORT[p.month - 1];
  const wd = WEEKDAYS_SHORT[p.weekday];
  switch (style) {
    case "day":
      return `${p.day} ${mon} ${p.year}`;
    case "dayShort":
      return `${p.day} ${mon}`;
    case "dayLong":
      return `${WEEKDAYS_LONG[p.weekday]} ${p.day} ${MONTHS_LONG[p.month - 1]} ${p.year}`;
    case "weekday":
      return `${wd} ${p.day} ${mon}`;
    case "time":
      return formatClock(p.hour, p.minute);
    case "dateTime":
      return `${wd} ${p.day} ${mon}, ${formatClock(p.hour, p.minute)}`;
    case "dateTimeZone":
      return `${wd} ${p.day} ${mon}, ${formatClock(p.hour, p.minute)} ${zoneAbbr(input, timeZone)}`;
  }
}

/** A calendar date with no time ("2026-09-24") as "24 Sep 2026", or "24 September" with { long: true, noYear: true }. */
export function formatCalendarDate(isoDate: string, opts: { long?: boolean; noYear?: boolean } = {}): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const mon = opts.long ? MONTHS_LONG[m - 1] : MONTHS_SHORT[m - 1];
  return opts.noYear ? `${d} ${mon}` : `${d} ${mon} ${y}`;
}

/**
 * Relative time against the demo's now. "just now", "12 min ago", "3 h ago", "Yesterday", "4 days ago".
 * Future instants read "just now" rather than a negative age.
 */
export function relativeTime(input: string | number | Date, now: string | number | Date = DEMO_NOW_MS): string {
  const diffMin = Math.floor((toMs(now) - toMs(input)) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  return `${d} days ago`;
}

/** Compact waiting time for queue rows: "4m", "1h 12m", "2d 3h". */
export function waitingTime(input: string | number | Date, now: string | number | Date = DEMO_NOW_MS): string {
  const diffMin = Math.max(0, Math.floor((toMs(now) - toMs(input)) / 60000));
  if (diffMin < 60) return `${diffMin}m`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return diffMin % 60 ? `${h}h ${diffMin % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Minutes waiting, for sorting and thresholds. */
export function minutesSince(input: string | number | Date, now: string | number | Date = DEMO_NOW_MS): number {
  return Math.max(0, Math.floor((toMs(now) - toMs(input)) / 60000));
}

/** Step timings: 84 -> "84 ms", 1240 -> "1.2 s". */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
}

/** Minutes as "45 min", "1 h 20 min". */
export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------- Versions, models and AI cost ----------

/** "rules-v1" -> "v1", "prompts-1.2" -> "v1.2". Labels already say which version it is. */
export function formatVersion(v: string): string {
  return v.replace(/^[a-z]+-v?/i, "v");
}

/** Readable model names for the trail. Unknown ids fall back to a tidied id. */
export const MODEL_LABEL: Record<string, string> = {
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-opus-5": "Claude Opus 5",
  "claude-opus-5-5": "Claude Opus 5.5",
  mock: "a simple built-in stand-in",
};

export function modelLabel(id: string): string {
  const base = id.replace(/-\d{8}$/, "");
  if (MODEL_LABEL[base]) return MODEL_LABEL[base];
  if (base.startsWith("mock")) return MODEL_LABEL.mock;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(base);
  if (m) return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}`;
  return base;
}

/** The trail footer's cost, mid-sentence: "no AI used" when nothing ran, otherwise "AI cost US$0.0196". */
export function aiCostText(usage: { costUsd: number }, models: { sort?: string; draft?: string }): string {
  if (usage.costUsd === 0 && !models.sort && !models.draft) return "no AI used";
  return `AI cost ${formatUsd(usage.costUsd)}`;
}

// ---------- Draft placeholders ----------

/**
 * The drafter writes "Hi [FIRST_NAME]," and signs off "[AGENT_NAME]" by design, so the AI never sees or invents a
 * name. The desk fills them in for display and sending. Run the fact check on the UNFILLED text.
 * fillDraftPlaceholders("Hi [FIRST_NAME],", "Priya", "Sam Carter") -> "Hi Priya,". Blank names leave the placeholder.
 */
export function fillDraftPlaceholders(text: string, firstName?: string, agentName?: string): string {
  let out = text;
  if (firstName?.trim()) out = out.replace(/\[FIRST_NAME\]/g, firstName.trim());
  if (agentName?.trim()) out = out.replace(/\[AGENT_NAME\]/g, agentName.trim());
  return out;
}

/**
 * Every placeholder that must never reach a patient: the drafter's two name slots and each stand-in the redaction step
 * writes over a hidden detail (PLACEHOLDERS in lib/pipeline/redact.ts). Kept as a plain list so the desk does not have
 * to import the pipeline; tests/desk-reply-gate.test.ts checks it against redact.ts.
 */
export const UNFILLED_PLACEHOLDERS = [
  "[FIRST_NAME]",
  "[AGENT_NAME]",
  "[NAME]",
  "[EMAIL]",
  "[PHONE]",
  "[ADDRESS]",
  "[DOB]",
  "[HEALTH ID]",
  "[CARD]",
  "[REDACTED]",
] as const;

/** One placeholder as the regex source that finds it: any case, spaces allowed inside the brackets. */
function placeholderSource(p: string): string {
  const word = p.slice(1, -1).split(/[ _]/).join(String.raw`[\s_]*`);
  return String.raw`\[\s*` + word + String.raw`\s*\]`;
}

const UNFILLED_RE = new RegExp(UNFILLED_PLACEHOLDERS.map(placeholderSource).join("|"), "i");

/**
 * True while a reply still holds a placeholder that has to be filled or taken out before it can be sent: "[FIRST_NAME]"
 * or "[AGENT_NAME]" from the drafter, or a hidden-detail stand-in such as "[PHONE]" or "[CARD]" left in an edited reply.
 * Case and spacing inside the brackets do not matter ("[phone]", "[ HEALTH ID ]").
 */
export function hasDraftPlaceholders(text: string): boolean {
  return UNFILLED_RE.test(text);
}

/** The placeholders still in a reply, in the order they first appear, written as the list above has them. */
export function unfilledPlaceholders(text: string): string[] {
  const found: { at: number; p: string }[] = [];
  for (const p of UNFILLED_PLACEHOLDERS) {
    const m = new RegExp(placeholderSource(p), "i").exec(text);
    if (m) found.push({ at: m.index, p });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.p);
}

// ---------- Numbers ----------

/** 0.923 -> "92%"; with digits 1 -> "92.3%". */
export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatNumber(n: number): string {
  const [i, d] = String(Math.round(n * 100) / 100).split(".");
  return groupThousands(i) + (d ? "." + d : "");
}

/**
 * A matched phrase short enough to sit in a list of chips. Most rule hits are a few words, but a whole-message check
 * (a supply used up far too early, a means and a final phrase in one sentence) can match a long stretch of the message:
 * the list shows its start, cut at a word, with an ellipsis. The message itself still highlights all of it.
 */
export function shortPhrase(phrase: string, max = 60): string {
  const flat = phrase.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.lastIndexOf(" ", max);
  return `${flat.slice(0, cut > max / 2 ? cut : max).replace(/[\s,;:.]+$/, "")}…`;
}

/** plural(3, "detail") -> "3 details"; plural(1, "order") -> "1 order". */
export function plural(n: number, singular: string, pluralForm = singular + "s"): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

// ---------- Product vocabulary (plain words, shared by every screen) ----------

/** Category names. Word for word identical to CATEGORY_LABELS in lib/pipeline/run.ts (used in trail summaries). */
export const CATEGORY_LABEL: Record<Category, string> = {
  order_status: "Order status",
  delivery_problem: "Delivery problem",
  script_renewal: "Script renewal",
  billing: "Billing",
  price_change: "Price change",
  plan_change: "Plan change",
  appointment: "Appointment",
  account_access: "Account access",
  product_question: "Product question",
  privacy_request: "Privacy request",
  complaint: "Complaint",
  wants_human: "Wants a person",
  other: "Other",
  clinical_question: "Clinical question",
  side_effect: "Side effect",
  adverse_event: "Adverse event",
  crisis: "Crisis language",
  bereavement: "Bereavement",
};

export function categoryLabel(c: Category | "stop_sending"): string {
  if (c === "stop_sending") return "Stop sending";
  return CATEGORY_LABEL[c];
}

/** A rule hit's category as a reason, mid-sentence: "stop_sending" reads "asked to stop deliveries". */
export function stopReasonLabel(c: Category | "stop_sending"): string {
  if (c === "stop_sending") return "asked to stop deliveries";
  return CATEGORY_LABEL[c];
}

export const ROUTE_LABEL: Record<Route, string> = {
  draft: "Ready to send",
  person: "Write the reply",
  clinician: "Clinician",
  urgent: "Urgent",
};

/** Longer route explanation for the decide step and tooltips. */
export const ROUTE_EXPLAINER: Record<Route, string> = {
  draft: "A checked draft is ready. You review it, then send, edit or escalate.",
  person: "No AI draft. A person writes this reply.",
  clinician: "No AI reply for this one. A clinician will answer.",
  urgent: "No AI reply. A clinician answers first, and the patient's orders are on hold.",
};

export const RISK_LABEL: Record<Risk, string> = {
  routine: "Routine",
  clinical: "Clinical",
  urgent: "Urgent",
};

/**
 * Step titles. Kept word for word identical to STEP_TITLES in lib/pipeline/run.ts (the titles the pipeline writes
 * into every trail), so a label on screen never differs from the trail it describes. This copy exists so UI code
 * does not have to import the pipeline.
 */
export const STEP_LABEL: Record<StepId, string> = {
  redact: "Personal details removed",
  rules: "Safety rules checked",
  sort: "Sorted by type",
  sources: "Sources found",
  draft: "Reply drafted",
  check: "Facts checked",
  decide: "A person decides",
};

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  passed: "Passed",
  stopped: "Stopped here",
  flagged: "Flagged",
  skipped: "Skipped",
  failed: "Blocked",
  pending: "Waiting",
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  order: "Order",
  charge: "Charge",
  appointment: "Appointment",
  plan: "Plan",
  policy: "Policy",
};

export const REDACTION_LABEL: Record<RedactionType, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  address: "Address",
  dob: "Date of birth",
  health_id: "Health ID",
  card: "Card number",
  other: "Other detail",
};

export const FACT_KIND_LABEL: Record<FactKind, string> = {
  date: "Date",
  amount: "Amount",
  order_id: "Order number",
  tracking: "Tracking number",
  duration: "Time frame",
  time: "Time",
  other: "Other",
};

/** Initials for avatars: "Olivia Brennan" -> "OB". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(dr|mr|mrs|ms|mx)\.?$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
