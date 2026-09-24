/**
 * Step 1: remove personal details before any AI sees the message.
 *
 * Deterministic and pattern based. Runs in Node, the browser and a Cloudflare Worker (no Node-only APIs).
 * Over-redacting is acceptable; leaking is not. Order ids (ORD-), tracking numbers (CD + 10 digits) and
 * money amounts are protected and never redacted, because the drafter needs them.
 */
import type { Patient, Redaction, RedactionType, ThreadEntry } from "@/lib/types";

export const PLACEHOLDERS: Record<RedactionType, string> = {
  name: "[NAME]",
  email: "[EMAIL]",
  phone: "[PHONE]",
  address: "[ADDRESS]",
  dob: "[DOB]",
  health_id: "[HEALTH ID]",
  card: "[CARD]",
  other: "[REDACTED]",
};

/** Output order of the counts, and the claim priority when two patterns overlap (earlier wins). */
const TYPE_ORDER: RedactionType[] = ["name", "email", "phone", "address", "dob", "health_id", "card", "other"];
const CLAIM_PRIORITY: RedactionType[] = ["email", "card", "health_id", "dob", "phone", "address", "name", "other"];

interface Span {
  start: number;
  end: number;
  type: RedactionType;
}

// ---------- helpers ----------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Kind regards" -> "[Kk]ind [Rr]egards": first letter of each word in either case, rest as written. */
function capFlex(phrase: string): string {
  return phrase
    .split(" ")
    .map((w) => {
      const f = w[0];
      const rest = escapeRe(w.slice(1)).replace(/'/g, "['’]?");
      return f.toLowerCase() !== f.toUpperCase() ? `[${f.toUpperCase()}${f.toLowerCase()}]${rest}` : escapeRe(f) + rest;
    })
    .join("\\s+");
}

/** Fully case-insensitive literal, for use inside a regex compiled without the i flag. */
function ciLit(word: string): string {
  return word
    .split("")
    .map((c) => (c.toLowerCase() !== c.toUpperCase() ? `[${c.toUpperCase()}${c.toLowerCase()}]` : escapeRe(c)))
    .join("");
}

/**
 * Full-width forms (U+FF01 to U+FF5E, as some mobile keyboards type "＠", "．" or "０４１２") and the small commercial at
 * (U+FE6B) mapped to plain ASCII, one UTF-16 unit for one, so indices are unchanged.
 */
function sameLengthFold(s: string): string {
  return s.replace(/[！-～﹫]/g, (c) => (c === "﹫" ? "@" : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

/** O or o typed for 0, and l or I for 1, next to a digit: "O412 345 678" reads as "0412 345 678". Same length. */
function digitLookalikes(s: string): string {
  return s.replace(/[OoIl](?=\d)|(?<=\d)[OoIl]/g, (c) => (c === "O" || c === "o" ? "0" : "1"));
}

function collect(re: RegExp, text: string, type: RedactionType, out: Span[], group = 0): void {
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    const whole = m[0];
    if (group === 0) {
      out.push({ start: m.index, end: m.index + whole.length, type });
      continue;
    }
    const g = m[group];
    if (!g) continue;
    const offset = whole.lastIndexOf(g);
    const start = m.index + offset;
    out.push({ start, end: start + g.length, type });
  }
}

// ---------- protected spans (never redacted) ----------

const PROTECTED: RegExp[] = [
  /\b(?:ORD|CHG|APT|MSG|PT)-\d+\b/gi, // our own record ids
  /\bCD\d{10}\b/g, // tracking numbers
  /(?:A\$|AU\$|NZ\$|US\$|\$|£|€|\b(?:AUD|NZD|GBP|USD)\s?)\d[\d,]*(?:\.\d{1,2})?/g, // amounts with a currency marker
  /\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars|bucks|pounds|AUD|NZD|GBP)\b/gi, // amounts with a trailing currency word
];

// ---------- email ----------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Spelled-out or disguised emails: "jo dot smith at gmail dot com", "jo.smith (at) gmail.com".
const TLD = "(?:com|net|org|co|nz|uk|au|edu|gov|io|me|info|biz)";
const MAIL_PROVIDERS =
  "(?:gmail|googlemail|hotmail|outlook|yahoo|ymail|icloud|bigpond|optusnet|iinet|tpg|xtra|btinternet|protonmail|proton|aol|msn|virginmedia|orcon|slingshot)";
// "(dot)", "[dot]", "{dot}", " dot " or "."; "(at)", "[at]", " at " or "@", with any spacing around the brackets:
// "farah(dot)tannous(at)example(dot)com(dot)au", "kaimoana.fan94 [at] example [dot] co [dot] nz".
// A "." with spaces on both sides also counts ("jane.smith @ gmail . com"); "at work. Me too" does not.
const OB_DOT = String.raw`(?:\s*[(\[{]\s*dot\s*[)\]}]\s*|\s+dot\s+|\s+\.\s+|\.)`;
const OB_AT = String.raw`(?:\s*[(\[{]\s*at\s*[)\]}]\s*|\s+at\s+|\s*@\s*)`;
const OB_LABEL = String.raw`[A-Za-z0-9_%+-]+`;
const OBFUSCATED_EMAIL_RES: RegExp[] = [
  new RegExp(String.raw`\b[\w.+-]+\s+(?:dot\s+[\w-]+\s+)*at\s+[\w-]+\s+dot\s+${TLD}(?:\s+dot\s+\w{2,3})*\b`, "gi"),
  new RegExp(String.raw`\b[\w.+-]+\s*(?:\(at\)|\[at\]|\s@\s|\s+at\s+)\s*[\w-]+(?:\.[\w-]+)*\.${TLD}\b`, "gi"),
  new RegExp(String.raw`\b${OB_LABEL}(?:${OB_DOT}${OB_LABEL})*${OB_AT}${OB_LABEL}(?:${OB_DOT}${OB_LABEL})*${OB_DOT}${TLD}\b`, "gi"),
  // A comma typed for a dot after the "@": "jane.smith@gmail,com".
  new RegExp(String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:[.,][A-Za-z0-9-]+)*[.,]\s?${TLD}\b`, "gi"),
  // A well-known mail provider with no ending: "jane.smith@gmail", "janesmith1984 at gmail", "\"jsmith\" at outlook".
  new RegExp(String.raw`[A-Za-z0-9._%+-]+@(?:${MAIL_PROVIDERS}|live|me)\b`, "gi"),
];
/** A handle written with " at " and a provider but no ending. The handle must look like one (a digit, dot or quotes). */
const PROVIDER_AT_RE = new RegExp(
  String.raw`(["'“”‘’])?\b([\w.+-]+)\b["'“”‘’]?(?:\s*\(at\)\s*|\s*\[at\]\s*|\s+at\s+)(?:${MAIL_PROVIDERS})(?:\s*(?:dot|\.)\s*${TLD})*\b`,
  "gi",
);
/**
 * A handle given with its provider but no "@": "my gmail is janedoe1988", "my hotmail is bigjim_77", "username on
 * gmail: janedoe1988". With a named provider any handle counts except an everyday word ("my gmail is down"); after a
 * plain "email" the handle must look like one (a digit, dot, underscore or plus), so "my email is broken" stays.
 */
const HANDLE_STOP = new Set(
  (
    "the a an my your our not no still down up out off broken working fine full same new old wrong right gone hacked " +
    "locked blocked empty spam junk there here this that it is was been being on in at to for from with and or but " +
    "correct different changed updated below above attached unchanged private personal"
  ).split(" "),
);
/** Providers that are also everyday words ("the outlook is good"): a handle only after "my", "her" and so on. */
const PLAIN_WORD_PROVIDER_RE = /^(?:outlook|live|e-?mail)$/i;
const POSSESSIVE_BEFORE_RE = /\b(?:my|his|her|their|our|your|mum['’]?s|dad['’]?s)[ \t]+$/i;
const PROVIDER_HANDLE_RE = new RegExp(
  String.raw`\b(${MAIL_PROVIDERS}|live|e-?mail)(?:[ \t]+(?:address|addy|username|user[ \t]?name|handle|account|id|login))?(?:[ \t]+is|[ \t]*[:=-]|['’]s)[ \t]*["'“”‘’]?([\w.+-]{3,64})`,
  "gi",
);
const HANDLE_ON_PROVIDER_RE = new RegExp(
  String.raw`\b(?:username|user[ \t]?name|handle|account|id|login|address)[ \t]+(?:on|for|at|with)[ \t]+(?:${MAIL_PROVIDERS}|live)(?:[ \t]+is|[ \t]*[:=-])[ \t]*["'“”‘’]?([\w.+-]{3,64})`,
  "gi",
);
function providerHandleSpans(text: string, out: Span[]): void {
  const push = (m: RegExpMatchArray, handle: string, generic: boolean) => {
    if (m.index === undefined) return;
    const h = handle.replace(/[.,]+$/, "");
    if (h.length < 3 || HANDLE_STOP.has(h.toLowerCase())) return;
    if (generic && !/[\d._+]/.test(h)) return;
    const start = m.index + m[0].lastIndexOf(handle);
    out.push({ start, end: start + h.length, type: "email" });
  };
  for (const m of text.matchAll(PROVIDER_HANDLE_RE)) {
    if (m.index === undefined) continue;
    if (PLAIN_WORD_PROVIDER_RE.test(m[1]) && !POSSESSIVE_BEFORE_RE.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
    push(m, m[2], /^e-?mail$/i.test(m[1]));
  }
  for (const m of text.matchAll(HANDLE_ON_PROVIDER_RE)) push(m, m[1], false);
}
/** An email typed one letter at a time: "j a n e @ g m a i l . c o m". */
const SPACED_EMAIL_RE = /(?<![\p{L}\p{N}_'’])(?:[A-Za-z0-9._+-] ){2,}[A-Za-z0-9._+-]? ?@(?: ?[A-Za-z0-9-]){2,}(?: ?(?:\.|dot)(?: ?[A-Za-z0-9-]){2,})+(?![\p{L}\p{N}_])/giu;

const EMAIL_CUE_RE = /\b(?:e-?mail|address|reach me|contact me|write to me|message me|inbox)\b[^.\n]{0,30}$/i;
/** Mail providers whose names are never everyday words, so a bare "janedoe at gmail" is an email. */
const UNAMBIGUOUS_PROVIDERS = "gmail|googlemail|hotmail|yahoo|ymail|icloud|bigpond|optusnet|iinet|xtra|btinternet|protonmail|virginmedia";
/** Everyday words that come before "at gmail" without being a handle: "problems at hotmail", "someone at gmail". */
const PLAIN_HANDLE_STOP = new Set(
  "account accounts address inbox email emails mail login logins problem problems issue issues trouble support someone somebody people anyone anybody everyone nobody staff team help working sign signed logged log".split(" "),
);
function providerEmailSpans(text: string, out: Span[]): void {
  for (const m of text.matchAll(PROVIDER_AT_RE)) {
    if (m.index === undefined) continue;
    const quoted = !!m[1];
    const handle = m[2];
    const cue = EMAIL_CUE_RE.test(text.slice(Math.max(0, m.index - 40), m.index));
    // A plain handle before a provider that is never an everyday word: "janedoe at gmail thanks". "Outlook" and "live"
    // are left to the cues above, and an everyday word before "at" ("problems at hotmail") is not a handle.
    const plainOk =
      handle.length >= 4 &&
      !HANDLE_STOP.has(handle.toLowerCase()) &&
      !PLAIN_HANDLE_STOP.has(handle.toLowerCase()) &&
      new RegExp(String.raw`^(?:\s*\(at\)\s*|\s*\[at\]\s*|\s+at\s+)(?:${UNAMBIGUOUS_PROVIDERS})\b`, "i").test(m[0].slice(m[0].indexOf(handle) + handle.length).replace(/^["'“”‘’]/, ""));
    if (!quoted && !/[\d._+]/.test(handle) && !cue && !plainOk) continue;
    out.push({ start: m.index, end: m.index + m[0].length, type: "email" });
  }
}

// ---------- card (13 to 19 digits, any grouping) ----------

// Groups may be split by up to two spaces, a hyphen, a dot or a slash ("4000  0566  5566  5556", "4111.1111.1111.1111").
const CARD_RE = new RegExp(String.raw`(?<![\d+])[2-6](?:(?: {1,2}|[-./])?\d){12,18}(?![\d])`, "g");
/**
 * Wider groupings: " / ", " - ", "|", "_" or "," between the groups ("4111 1111 / 1111 1111", "4111|1111|1111|1111").
 * Hidden when the digits pass the card check (Luhn) or a card word comes just before, so a date range such as
 * "22/09/2026 - 25/09/2026" is left alone.
 */
const CARD_WIDE_RE = /(?<![\d+])[2-6](?:(?: {0,2}[-/|_] {0,2}| {1,2}|[.,])?\d){12,18}(?!\d)/g;
const CARD_CUE_RE = /\b(?:card|cc|visa|master ?card|amex|debit|credit|long number|card number)\b[^.\n]{0,30}$/i;
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}
function wideCardSpans(text: string, out: Span[]): void {
  for (const m of text.matchAll(CARD_WIDE_RE)) {
    if (m.index === undefined) continue;
    const digits = m[0].replace(/\D/g, "");
    const cue = CARD_CUE_RE.test(text.slice(Math.max(0, m.index - 40), m.index));
    if (luhn(digits) || cue) out.push({ start: m.index, end: m.index + m[0].length, type: "card" });
  }
}
/** A card's expiry and security code: "exp 11/29", "expiry: 10/2029", "cvv 318", "security code is 123". */
const CARD_EXTRA_RES: RegExp[] = [
  /\b(?:exp(?:iry|ires|iration)?(?:\s+date)?|valid\s+(?:thru|through|until|to)|good\s+thru|expiry\s+is)\.?\s*(?:is|:|-)?\s*(\d{1,2}\s?[/-]\s?(?:\d{4}|\d{2}))(?![\d/])/gi,
  /\b(?:cvv2?|cvc2?|csc|cv2|security\s+code|card\s+code|3[- ]digit\s+(?:code|number)|three[- ]digit\s+(?:code|number))\s*(?:is|:|-|number|no\.?)?\s*(\d{3,4})\b/gi,
  // Words between the keyword and the digits: "security code on the back is 987", "the security number on the back is
  // 987", "the 3 digits on the back are 456". The digits never run on into a longer number (a phone number).
  /\b(?:security\s+(?:code|number|no\.?|digits)|cvv2?|cvc2?|csc|cv2|card\s+(?:code|security)|(?:3|4|three|four)[- ]?digits?(?:\s+(?:code|number))?\s+(?:on|from|at)\s+the\s+back|digits?\s+on\s+the\s+back|(?:number|code)\s+on\s+the\s+back)\b(?:[ \t]+(?!\d)[\p{L}'’.]+){0,6}?[ \t]*(?:is|are|:|-|=)?[ \t]*(\d{3,4})(?![ \t.,/-]?\d)/giu,
  // A code right after a card expiry: "card expiry 09/28, code 552", "exp 11/29 cvv 318".
  /\bexp(?:iry|ires|iration)?(?:\s+date)?\.?\s*(?:is|:|-)?\s*\d{1,2}\s?[/-]\s?(?:\d{4}|\d{2}),?\s+(?:and\s+)?(?:the\s+)?(?:(?:security\s+)?code|cvv2?|cvc2?|csc|cv2|security|digits|number)?\s*(?:is|:|-|=)?\s*(\d{3,4})(?![ \t.,/-]?\d)/gi,
];

// ---------- health identifiers ----------

const HEALTH_RES: RegExp[] = [
  // Medicare-like: 10 digits (optionally an 11th IRN digit), commonly grouped 4-5-1
  new RegExp(String.raw`(?<![\d+])[2-6]\d{3}[ -]\d{5}[ -]\d(?:[ -]?\d)?(?![\d])`, "g"),
  // NHS-like: "485 777 3456", "943.476.5919"
  new RegExp(String.raw`(?<![\d+.])[1-9]\d{2}[ .-]\d{3}[ .-]\d{4}(?![\d]|\.\d)`, "g"),
  // Unformatted 10 or 11 digits not starting 0 or 1 (0 = phone, 1 = 1300/1800 numbers)
  new RegExp(String.raw`(?<![\d+])[2-9]\d{9,10}(?![\d])`, "g"),
  // NHI-like: 3 letters (no I or O) + 4 digits, or the newer 3 letters + 2 digits + 2 letters. Any case, because a
  // patient may type "zey0888"; over-redacting a rare lookalike token is acceptable by design.
  /\b[A-HJ-NP-Z]{3}\d{4}\b/gi,
  /\b[A-HJ-NP-Z]{3}\d{2}[A-HJ-NP-Z]{2}\b/gi,
  // An NHI written with a space or hyphen ("ZZZ 0016", "ZZZ-0016"): capitals only, so "the 2026" and "NSW 2000" stay.
  /\b(?!(?:NSW|VIC|QLD|TAS|ACT|GST|ABN|ACN|NZD|AUD|GBP|USD|EUR|ORD|CHG|APT|MSG|PTY|LTD)\b)[A-HJ-NP-Z]{3}[ -]\d{4}\b/g,
  // Centrelink CRN (Health Care Card, Pensioner Concession Card): 9 digits and a letter, "204 118 395K", "123-456-789A".
  /(?<![\p{L}\p{N}_])\d{3}[\s-]?\d{3}[\s-]?\d{3}[\s-]?[A-Za-z](?![\p{L}\p{N}_])/gu,
  // Scottish CHI number: 10 digits, written 6 + 4 ("240974 1826"). It starts with the date of birth.
  /(?<![\d+])\d{6}[ -]\d{4}(?![\d])/g,
];
// Any id-ish token right after a health-number keyword ("Medicare no. 21234567", "NHI: zzz0016", "CRN 204118395K")
const HEALTH_KEYWORD_RE =
  /\b(?:(?:medicare|nhs|nhi|ihi|chi|crn|dva|centrelink)(?:\s+(?:card|number|no\.?|num|#|id|reference))*|health\s+(?:care\s+)?(?:card|number|no\.?|id)(?:\s+number)?|customer\s+reference\s+number|pension(?:er)?\s+(?:concession\s+)?card(?:\s+number)?|(?:concession|community\s+services|seniors?|veterans?\s+gold|gold|low\s+income\s+health\s+care)\s+card(?:\s+(?:number|no\.?|num|#))?)\s*(?:is|:|#|-)?\s*([A-Za-z]{0,3}[ -]?\d[\d .-]{2,22}\d[A-Za-z]?)/gi;
/**
 * Health ids with words between the keyword and the number, and hospital record numbers (round 4 red team):
 * "DVA file number NX901667", "veterans file no. NX901667", "MRN 00123456", "hospital UR number 1234567", "URN 1234567
 * at the Alfred", "patient ID 7788991", and private health insurance member numbers ("HCF membership 987654321").
 * "UR" and "URN" are read in capitals only, so the text-speak "ur" (your) never counts.
 */
const HEALTH_EXTRA_RES: RegExp[] = [
  /\b(?:DVA|veterans?['’]?(?:\s+affairs)?)\b(?:[ \t]+(?!(?:is|are)\b)[\p{L}.]+){0,3}?[ \t]*(?:is|:|#|-)?[ \t]*([A-Za-z]{1,4}[ \t]?\d{4,8}[A-Za-z]?)(?![\p{L}\p{N}])/giu,
  /\b(?:MRN|UR|URN|U\.R\.)(?:[ \t]+(?:number|no\.?|num|#))?[ \t]*(?:is|:|#|-)?[ \t]*([A-Za-z]{0,4}\d{5,10}[A-Za-z]?)(?![\p{L}\p{N}])/gu,
  /\b(?:medical[ \t]+records?|hospital(?:[ \t]+(?:UR|record|records|patient))?|patient|clinic|record|unit[ \t]+record)[ \t]+(?:number|no\.?|num|#|id|identifier)(?:[ \t]+(?:is|was))?[ \t]*[:#-]?[ \t]*([A-Za-z]{0,4}\d{5,10}[A-Za-z]?)(?![\p{L}\p{N}])/giu,
  /\b(?:health[ \t]+fund|private[ \t]+health(?:[ \t]+(?:insurance|cover|fund))?|health[ \t]+insurance|bupa|medibank|hcf|nib|ahm|hbf|gmhba|southern[ \t]+cross|axa|vitality|cigna|westfield[ \t]+health|simplyhealth|aviva|teachers[ \t]+health|defence[ \t]+health)\b[ \t]*[:,-]?(?:[ \t]+[\p{L}]+){0,2}?[ \t]+(?:member(?:ship)?|policy|customer|account|card)(?:[ \t]+(?:no\.?|number|num|#|id))?(?:[ \t]+(?:is|was))?[ \t]*[:#-]?[ \t]*(\d(?:[\d \t]{4,14})\d)(?!\d)/giu,
];
/** A UK National Insurance number ("QQ 12 34 56 C"), and other government ids after their keyword. */
const OTHER_ID_RES: RegExp[] = [
  /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g,
  /\b(?:national\s+insurance(?:\s+(?:number|no\.?))?|NI\s+(?:number|no\.?)|NINO|tax\s+file\s+number|TFN|IRD(?:\s+(?:number|no\.?))?|passport(?:\s+(?:number|no\.?))?|(?:driver['’]?s?\s+)?licen[cs]e(?:\s+(?:number|no\.?|num|#))?)\s*(?:is|:|#|-)?\s*([A-Za-z]{0,3}\s?\d[\d -]{4,14}\d?\s?[A-Za-z]?)/gi,
  // Bank details for a refund: "BSB 062-000", "sort code 12-34-56", "account 12345678", "acct no. 12-3456-7890123-00".
  /\b(?:BSB|sort[ \t]?code|bank[ \t]+code)(?:[ \t]+(?:number|no\.?|num))?[ \t]*(?:is|:|#|-)?[ \t]*(\d{2,3}(?:[ \t]?[-.][ \t]?|[ \t])?\d{2,3}(?:(?:[ \t]?[-.][ \t]?|[ \t])?\d{2})?)(?!\d)/gi,
  /\b(?:(?:bank[ \t]+)?account|acct|acc)(?:[ \t]+(?:number|no\.?|num|#))?[ \t]*(?:is|:|#|-)?[ \t]*(\d[\d -]{4,20}\d)(?!\d)/gi,
  // A National Insurance number in any case after its keyword: "ni qq 12 34 56 c".
  /\b(?:ni|nino|national\s+insurance)(?:\s+(?:number|no\.?))?\s*(?:is|:|#|-)?\s*([A-Za-z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-Da-d])\b/gi,
];

/**
 * An IBAN, redacted as one span so the country and check digits never stay behind ("IBAN GB82 WEST 1234 5698 7654 32").
 * It claims over the card and phone patterns that would take only its digit groups.
 */
const IBAN_RES: RegExp[] = [
  /\bIBAN\b[ \t]*(?:no\.?|number|num)?[ \t]*(?:is|:|#|-)?[ \t]*([A-Za-z]{2}[ \t]?\d{2}(?:[ \t]?[A-Za-z0-9]{4}){2,7}(?:[ \t]?[A-Za-z0-9]{1,4})?)(?![A-Za-z0-9])/gi,
  /\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?)(?![A-Za-z0-9])/g,
];
/**
 * A social media handle: "my ig is @jane.doe.88", "instagram @jane.doe.88", or any "@" handle with a digit or a dot that is
 * not part of an email. "Your email @ the top" has a space after the "@", and "@3pm" is a time.
 */
const SOCIAL_HANDLE_RES: RegExp[] = [
  /\b(?:ig|insta|instagram|facebook|fb|tiktok|tik tok|twitter|snapchat|snap|whatsapp|threads|telegram|linkedin|x)\b(?:[ \t]+(?:handle|username|user[ \t]?name|account|name|id|page))?(?:[ \t]+is|[ \t]*[:=-])?[ \t]*(@[A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_])?)/gi,
  /\b(?:ig|insta|instagram|tiktok|snapchat|snap)\b(?:[ \t]+(?:handle|username|user[ \t]?name|account|name|id))?(?:[ \t]+is|[ \t]*[:=-])[ \t]*([A-Za-z0-9_][A-Za-z0-9_.]*[0-9._][A-Za-z0-9_.]*[A-Za-z0-9_])(?![A-Za-z0-9_.@])/gi,
  /(?<![\p{L}\p{N}_.@])(@(?!\d{1,2}(?::\d{2})?\s?(?:am|pm)\b)(?=[A-Za-z0-9_.]*[\d.])[A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_]){2,})(?![\p{L}\p{N}_@])/gu,
];

/** The name printed on a card, initials included: "name on card B J Castellano" (MSG-0930 kept "B J" visible). */
const NAME_ON_CARD_RE =
  /\b[Nn]ame\s+on\s+(?:the\s+|my\s+|his\s+|her\s+)?[Cc]ard(?:\s+is|\s*[:-])?[ \t]*((?:\p{Lu}\.?[ \t]+){0,3}\p{Lu}[\p{L}'’-]+(?:[ \t]+\p{Lu}[\p{L}'’-]+)?|(?:\p{Lu}\.?[ \t]*){1,3}(?![\p{L}]))/gu;

// ---------- phone (AU, NZ, UK) ----------

// A slash also separates phone groups ("0412/345/678"); dates are matched by their own patterns and claim first.
const SEP = String.raw`[\s./-]?`;
/**
 * "+61", "+ 61", "0061" (the exit code), each with an optional "(0)", and the first national digit optionally in
 * brackets ("+61 (4) 1234 5678"): the bodies below allow the closing bracket after it.
 */
function intl(cc: string): string {
  return String.raw`(?:\+\s?|00)${cc}${SEP}(?:\(0\)${SEP})?\(?`;
}
const PHONE_BODIES: string[] = [
  // AU mobile 04xx xxx xxx
  String.raw`(?:${intl("61")}|\(?0)4\)?(?:${SEP}\d){8}`,
  // AU landline (0X) xxxx xxxx
  String.raw`(?:${intl("61")}|\(?0)[2378]\)?(?:${SEP}\d){8}`,
  // AU 1300 / 1800
  String.raw`1[38]00(?:${SEP}\d){6}`,
  // NZ mobile 02x xxx xxxx
  String.raw`(?:${intl("64")}|\(?0)2\d\)?(?:${SEP}\d){6,8}`,
  // NZ landline 0X xxx xxxx
  String.raw`(?:${intl("64")}|\(?0)[3-79]\)?(?:${SEP}\d){7}`,
  // NZ / UK freephone 0800
  String.raw`0800(?:${SEP}\d){6,7}`,
  // UK mobile 07xxx xxxxxx
  String.raw`(?:${intl("44")}|\(?0)7\d{3}\)?(?:${SEP}\d){6}`,
  // UK geographic 01xxx / 02x / 03xx
  String.raw`(?:${intl("44")}|\(?0)[1-3]\d{1,4}\)?(?:${SEP}\d){5,8}`,
  // Any prefix in brackets: "(0491) 573 087", "(03) 5550 2291"
  String.raw`\(0\d{1,4}\)${SEP}\d{3,4}${SEP}\d{3,4}`,
  // A mobile written with the country code but no plus: "64 27 555 0199", "61 491 570 159", "44 7700 900519".
  String.raw`64${SEP}2\d(?:${SEP}\d){6,8}`,
  String.raw`61${SEP}4(?:${SEP}\d){8}`,
  String.raw`44${SEP}7\d{3}(?:${SEP}\d){6}`,
];
const PHONE_RE = new RegExp(String.raw`(?<![\w+])(?:${PHONE_BODIES.join("|")})(?![\d])`, "g");
/**
 * A number right after a phone word, in any grouping, for local numbers written without an area code ("the landline
 * at home, 5550 3172"). Eight digits are enough here because the word says it is a phone number.
 */
const PHONE_KEYWORD_RE =
  /\b(?:landline|phone|mobile|mob|cell|tel|telephone|fax|ring (?:me|us|her|him)|call (?:me|us|her|him)|text (?:me|us|her|him)|number)\b[^.\n\d]{0,30}?((?:\+|00)?\(?\d[\d\s().-]{6,16}\d)/gi;

/**
 * A number spoken as digit words: "oh four one two, three four five, six seven eight", "zero four double one ...".
 * Read as digits and hidden when the result is a phone number's length (or a health number's, after its keyword).
 */
const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", o: "0", nought: "0", nil: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9",
};
const DIGIT_WORD = String.raw`(?:(?:double|triple)[ \t]+)?(?:zero|oh|nought|nil|one|two|three|four|five|six|seven|eight|nine|\d)`;
// Between two tokens: a space, comma, dot or hyphen, or nothing at all where a digit meets a digit or a number word
// ("04one2 345 678").
const DIGIT_SEP = String.raw`(?:[ \t,.-]{1,3}|(?<=\d)(?=[\p{L}\d])|(?<=\p{L})(?=\d))`;
const SPOKEN_NUMBER_RE = new RegExp(String.raw`(?<![\p{L}\p{N}_])${DIGIT_WORD}(?:${DIGIT_SEP}${DIGIT_WORD}){5,}(?![\p{L}\p{N}_])`, "giu");
const DIGIT_TOKEN_RE = /double|triple|zero|oh|nought|nil|one|two|three|four|five|six|seven|eight|nine|\d/gi;
/** A card word just before a spoken number: "my card: four one one one, ...". */
const SPOKEN_CARD_CUE_RE = /\b(?:card|cc|visa|master ?card|amex|debit|credit|long number)\b[^.\n\d]{0,30}$/i;
function spokenDigits(s: string): string {
  let out = "";
  const words = (s.toLowerCase().match(DIGIT_TOKEN_RE) ?? []).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const times = w === "double" ? 2 : w === "triple" ? 3 : 1;
    const d = times > 1 ? words[++i] : w;
    const digit = d === undefined ? "" : /^\d$/.test(d) ? d : DIGIT_WORDS[d] ?? "";
    out += digit.repeat(times);
  }
  return out;
}
/** A number typed one digit at a time: "2 1 2 3 4 5 6 7 0 1" (a Medicare number), "0 4 1 2 3 4 5 6 7 8" (a mobile). */
const SPACED_DIGITS_RE = /(?<![\p{L}\p{N}_.,/-])\d(?:[ \t]\d){8,12}(?![ \t]?\p{N})/gu;
function spokenPhoneSpans(text: string, out: Span[]): void {
  for (const m of text.matchAll(SPACED_DIGITS_RE)) {
    if (m.index === undefined) continue;
    out.push({ start: m.index, end: m.index + m[0].length, type: m[0].startsWith("0") ? "phone" : "health_id" });
  }
  for (const m of text.matchAll(SPOKEN_NUMBER_RE)) {
    if (m.index === undefined) continue;
    // Only a run with at least one digit word: "0412 345 678" is left to the numeric patterns.
    if (!/[a-z]/i.test(m[0])) continue;
    const digits = spokenDigits(m[0]);
    const end = m.index + m[0].replace(/[\s,.-]+$/, "").length;
    // A card read out digit by digit: 14 to 19 digits, or 13 after a card word.
    const cardCue = SPOKEN_CARD_CUE_RE.test(text.slice(Math.max(0, m.index - 40), m.index));
    if (digits.length >= 13 && digits.length <= 19 && (digits.length >= 14 || cardCue)) {
      out.push({ start: m.index, end, type: "card" });
      continue;
    }
    if (digits.length < 8 || digits.length > 13) continue;
    const phoneLike = /^(?:0|61|64|44|1[38]00)/.test(digits);
    out.push({ start: m.index, end, type: phoneLike ? "phone" : "health_id" });
  }
}

/** The digits of a phone number, without a "00" exit code ("0044 7700 900519" has 12). */
function phoneDigits(s: string): string {
  return s.replace(/\D/g, "").replace(/^00(?=[1-9])/, "");
}
function validPhone(s: string): boolean {
  const digits = phoneDigits(s);
  return digits.length >= 9 && digits.length <= 13;
}

// ---------- dates of birth ----------

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
/** Ordinal days and years in words: "the twenty-sixth of March, nineteen fifty-two". */
const ORDINAL_WORD =
  String.raw`(?:(?:twenty|thirty)[\s-](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)`;
const TENS_WORD = String.raw`(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)`;
const UNIT_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine)`;
const TEEN_WORD = String.raw`(?:ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)`;
const YEAR_WORDS = String.raw`(?:nineteen[\s-](?:${TENS_WORD}(?:[\s-]${UNIT_WORD})?|${TEEN_WORD}|hundred|oh[\s-]${UNIT_WORD})|two thousand(?:\s+and)?(?:[\s-](?:${TENS_WORD}(?:[\s-]${UNIT_WORD})?|${TEEN_WORD}|${UNIT_WORD}))?)`;
// Every form here is a candidate only: dobSpans hides it when a birth keyword sits next to it (or it is the patient's
// own date of birth), so the looser forms (a month and year, a day and month, eight digits) never hide an ordinary date.
const DATE_SRC = [
  String.raw`\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}`,
  String.raw`\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}`,
  // "19850303", "03031985"
  String.raw`\d{8}`,
  // "March 1985", "March '85"
  String.raw`(?:${MONTHS})\.?,?\s+(?:\d{4}|['’]\d{2})`,
  // "03/03" with no year
  String.raw`\d{1,2}[\/.-]\d{1,2}(?![\/.-]?\d)`,
  // "03-Oct-81", "02-Nov-94", "3.Oct.1981"
  String.raw`\d{1,2}[\/.-](?:${MONTHS})[\/.-](?:\d{4}|\d{2})`,
  String.raw`\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+(?:${MONTHS})\.?(?:,?\s+(?:\d{4}|['’]?\d{2}))?`,
  String.raw`(?:${MONTHS})\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+(?:\d{4}|['’]?\d{2}))?`,
  String.raw`(?:the\s+)?${ORDINAL_WORD}\s+(?:of\s+)?(?:${MONTHS})(?:,?\s+(?:${YEAR_WORDS}|\d{4}))?`,
  String.raw`(?:${MONTHS})\s+(?:the\s+)?${ORDINAL_WORD}(?:,?\s+(?:${YEAR_WORDS}|\d{4}))?`,
].join("|");
const DATE_RE = new RegExp(String.raw`\b(?:${DATE_SRC})\b`, "gi");
// "born", "DOB", and a birthday by age: "she would have turned 75 on the 16th of Feb", "he turns 40 on".
const DOB_KEYWORD_RE =
  /\b(?:born|dob|d\.o\.b\.?|date\s+of\s+birth|birth\s*date|birthday|bday|b'day|(?:turn(?:s|ed|ing)?|would have (?:turned|been)|will be) \d{1,3})(?![a-z])|\bb\.(?=[ \t]*\d)/gi;
/**
 * The latest year a patient can be born in: every patient is an adult, 16 or more years before the demo's today
 * (23 September 2026, DEMO_TODAY in lib/pipeline/check.ts). A full date from this year or earlier is read as a birth date.
 */
const LATEST_BIRTH_YEAR = 2026 - 16;
const BORN_YEAR_RE = /\bborn\s+(?:in\s+)?((?:19|20)\d{2})\b/gi;

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse a date candidate into [year|undefined, month, day] (day-first for numeric forms). */
function parseDate(s: string): { y?: number; m: number; d: number } | null {
  const t = s.trim();
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(t);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  // "19850303" year first, else "03031985" day first.
  m = /^((?:19|20)\d{2})(\d{2})(\d{2})$/.exec(t);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { y: +m[1], m: +m[2], d: +m[3] };
  m = /^(\d{2})(\d{2})((?:19|20)\d{2})$/.exec(t);
  if (m) return { y: +m[3], m: +m[2], d: +m[1] };
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y > 30 ? 1900 : 2000;
    return { y, m: +m[2], d: +m[1] };
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([A-Za-z]+)\.?(?:,?\s+['’]?(\d{4}|\d{2}))?$/.exec(t);
  if (m) {
    const mi = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()];
    if (mi) return { y: fullYear(m[3]), m: mi, d: +m[1] };
  }
  m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+['’]?(\d{4}|\d{2}))?$/.exec(t);
  if (m) {
    const mi = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
    if (mi) return { y: fullYear(m[3]), m: mi, d: +m[2] };
  }
  return null;
}

/** "1985" -> 1985, "85" -> 1985, "03" -> 2003, missing -> undefined. */
function fullYear(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const y = +s;
  return s.length === 2 ? y + (y > 30 ? 1900 : 2000) : y;
}

function dobSpans(text: string, patient: Patient | undefined, out: Span[]): void {
  const dates = [...text.matchAll(DATE_RE)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, s: m[0] }));
  const keywords = [...text.matchAll(DOB_KEYWORD_RE)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));

  let patientDob: { y: number; m: number; d: number } | null = null;
  if (patient?.dob) {
    const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(patient.dob);
    if (p) patientDob = { y: +p[1], m: +p[2], d: +p[3] };
  }

  dates.forEach((dt, i) => {
    // A keyword before the date, within 30 characters, with no other date in between.
    const prevDateEnd = i > 0 ? dates[i - 1].end : -1;
    const before = keywords.some((k) => k.end <= dt.start && dt.start - k.end <= 30 && k.start >= prevDateEnd);
    // Or a keyword just after it: "12/03/1985 (DOB)"
    // A keyword that leads straight into the next date belongs to it: in "valid from 18/09/2026\n\ndob 03-Oct-81"
    // the "dob" is the second date's, so the card's validity date is not read as a birth date.
    const nextDateStart = i < dates.length - 1 ? dates[i + 1].start : Infinity;
    const after = keywords.some(
      (k) => k.start >= dt.end && k.start - dt.end <= 12 && k.end <= nextDateStart && nextDateStart - k.end > 30,
    );
    let isDob = before || after;
    if (!isDob && patientDob) {
      const p = parseDate(dt.s);
      if (p && p.y === patientDob.y && p.m === patientDob.m && p.d === patientDob.d) isDob = true;
    }
    // A full numeric date from a birth-era year ("14/03/1985", "3/4/1962"), with no keyword: order, delivery and
    // appointment dates in this product are all in the current year, so "delivered 14.03.2026" keeps its date.
    if (!isDob && /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$|^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}$/.test(dt.s.trim())) {
      const p = parseDate(dt.s);
      if (p?.y !== undefined && p.y >= 1900 && p.y <= LATEST_BIRTH_YEAR && p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= 31) isDob = true;
    }
    if (isDob) out.push({ start: dt.start, end: dt.end, type: "dob" });
  });
  collect(BORN_YEAR_RE, text, "dob", out, 1);
}

// ---------- street addresses ----------

// Street types that are unambiguous: matched in any case ("12 smith st").
const STREET_TYPES_ANY_CASE = [
  "Street", "St", "Road", "Rd", "Avenue", "Ave", "Av", "Crescent", "Cres", "Boulevard", "Blvd", "Highway", "Hwy",
  "Tce", "Pde", "Cct", "Esp", "Ln", "Ct", "Pl", "Dr", "Gr", "Cl", "Sq", "Gdns", "Hwy",
  // Abbreviations that are never everyday words: "Banksia Drv", "Kowhai Hts", "Coral Bvd".
  "Drv", "Dve", "Hts", "Cir", "Bvd", "Bvde", "Rdg", "Prom", "Crt", "Crst", "Wy", "Pkwy", "Pky", "Mwy", "Qy", "Rte",
];
// Street types that are also everyday words: only matched capitalised, after capitalised name words.
const STREET_TYPES_CAPITALISED = [
  "Drive", "Lane", "Court", "Place", "Terrace", "Parade", "Circuit", "Esplanade", "Way", "Row", "Walk", "Rise",
  "Close", "Hill", "Grove", "Square", "Gardens", "Mews", "Quay", "Track", "Loop", "Crest", "View", "Vale", "Green",
  "Heights", "Circle", "Mall", "Wynd", "Glen", "Promenade", "Ridge", "Parkway", "Retreat", "Chase", "Brae",
];
const NAME_STOP =
  "the|a|an|my|your|our|on|of|in|to|and|or|at|for|is|was|it|this|that|days?|weeks?|hours?|months?|times?|bottles?|orders?|items?|more|last|next|x";
// Unicode-aware word pieces, so te reo Māori and accented names ("Kōtuku", "Ōtaki", "Renée") are handled like
// ASCII ones. Every regex that uses them is compiled with the u flag. NOT_WORD replaces \b / (?!\w), which only
// know ASCII letters.
const NOT_WORD = String.raw`(?![\p{L}\p{N}_])`;
const STREET_NAME_ANY = String.raw`(?!(?:${NAME_STOP})${NOT_WORD})\p{L}[\p{L}\p{M}'’.-]*`;
const STREET_NAME_CAP = String.raw`\p{Lu}[\p{L}\p{M}'’.-]*`;
const UNIT_PREFIX = String.raw`(?:(?:${["Unit", "Apartment", "Apt", "Flat", "Suite", "Level", "Lvl", "Shop", "U"]
  .map(ciLit)
  .join("|")})\.?\s*\d+[A-Za-z]?\s*[,/]?\s*)?`;
const HOUSE_NO = String.raw`\d{1,5}[A-Za-z]?(?:\s*[/-]\s*\d{1,5}[A-Za-z]?)?`;
const AU_STATES = "VIC|NSW|QLD|SA|WA|TAS|NT|ACT|Vic|Qld|Tas";
const UK_POSTCODE = String.raw`(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})`;
const DIRECTION = String.raw`(?:[ \t]+(?:North|South|East|West|Nth|Sth))?`;
const PLACE_WORD = String.raw`\p{Lu}[\p{L}\p{M}'’-]+${NOT_WORD}`;
/** One to three capitalised place words on one line: "Carlton", "Mount Maunganui", "North Dunedin". */
const PLACE_WORDS = String.raw`${PLACE_WORD}(?:[ \t]+${PLACE_WORD}){0,2}`;
/** Capitalised words that start a sign-off or a sentence, never a suburb line under an address. */
const NOT_PLACE = String.raw`(?!(?:Thanks|Thank|Thankyou|Cheers|Kind|Kindest|Best|Warm|Warmest|Many|Regards|Love|Yours|Sincerely|Ngā|Nga|Kia|Mauri|Noho|Hi|Hello|Hey|Dear|Please|Sent|Ta|Sorry|Also|And|But|Can|Could|Would|Will|My|The|This|That|It|I|Is|Just)${NOT_WORD})`;
const POSTCODE = String.raw`(?:\d{4}|${UK_POSTCODE})`;
const MONTH_OR_DAY = String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)`;
/** A New Zealand rural delivery number: "RD 2", "R.D. 4". */
const RURAL = String.raw`(?:RD|R\.D\.|Rural Delivery)[ \t]*\d{1,3}${NOT_WORD}`;
const ADDRESS_TAIL =
  // ", Carlton VIC 3053" / ", Mount Maunganui, Tauranga 3116" / " Carlton VIC 3053" / " Mount Maunganui Tauranga 3116" /
  // ", RD 2, Te Awamutu" / " Mornington." (one to three place words that end the sentence)
  String.raw`(?:(?:,\s*(?:${RURAL}|${NOT_PLACE}${PLACE_WORDS})){1,3}(?:,?[ \t]+(?:${AU_STATES}))?(?:,?[ \t]+${POSTCODE})?` +
  String.raw`|[ \t]+${NOT_PLACE}${PLACE_WORDS}(?:,?[ \t]+(?:${AU_STATES}))?,?[ \t]+${POSTCODE}` +
  String.raw`|[ \t]+${NOT_PLACE}${PLACE_WORDS},?[ \t]+(?:${AU_STATES})${NOT_WORD}` +
  String.raw`|[ \t]+(?!${MONTH_OR_DAY}${NOT_WORD})${NOT_PLACE}${PLACE_WORDS}(?=[ \t]*(?:[.!?]|\r?\n|$)))?` +
  // Then whole lines of suburb, city and postcode written under the street line:
  // "18 Kōtuku Lane\nMount Maunganui\nTauranga 3116"
  String.raw`(?:[ \t]*,?[ \t]*\r?\n[ \t]*${NOT_PLACE}${PLACE_WORDS}(?:,?[ \t]+(?:${AU_STATES}))?(?:,?[ \t]+${POSTCODE})?[ \t]*,?(?=[ \t]*(?:\r?\n|$))){0,3}`;

const ADDRESS_RES: RegExp[] = [
  new RegExp(
    String.raw`(?<![\p{L}\p{N}_$£.-])${UNIT_PREFIX}${HOUSE_NO}\s+(?:${STREET_NAME_ANY}\s+){1,3}(?:${STREET_TYPES_ANY_CASE.map(ciLit).join("|")})${NOT_WORD}\.?${DIRECTION}${ADDRESS_TAIL}`,
    "gu",
  ),
  new RegExp(
    String.raw`(?<![\p{L}\p{N}_$£.-])${UNIT_PREFIX}${HOUSE_NO}\s+(?:${STREET_NAME_CAP}\s+){1,3}(?:${STREET_TYPES_CAPITALISED.join("|")})${NOT_WORD}${DIRECTION}${ADDRESS_TAIL}`,
    "gu",
  ),
  // A New Zealand rural address: "1442 RD 2, Te Awamutu 3872", "55 Paterangi RD 2".
  new RegExp(String.raw`(?<![\p{L}\p{N}_$£.-])${HOUSE_NO}\s+(?:${STREET_NAME_CAP}\s+){0,3}${RURAL}${ADDRESS_TAIL}`, "gu"),
  // A street written all in lower case ("14 banksia drive"), after a delivery cue or before a postcode.
  new RegExp(
    String.raw`(?<=\b(?:${[
      "deliver to", "deliver it to", "deliver them to", "delivered to", "send to", "send it to", "send them to",
      "send my order to", "sent to", "ship to", "ship it to", "post it to", "post to", "address is", "address:",
      "new address is", "new address:", "live at", "living at", "moved to", "moving to", "staying at",
    ]
      .map(ciLit)
      .join("|")})\s+)${UNIT_PREFIX}${HOUSE_NO}\s+(?:${STREET_NAME_ANY}\s+){1,3}(?:${[...STREET_TYPES_ANY_CASE, ...STREET_TYPES_CAPITALISED].map(ciLit).join("|")})${NOT_WORD}\.?${DIRECTION}${ADDRESS_TAIL}`,
    "gu",
  ),
  new RegExp(
    String.raw`(?<![\p{L}\p{N}_$£.-])${UNIT_PREFIX}${HOUSE_NO}\s+(?:${STREET_NAME_ANY}\s+){1,3}(?:${STREET_TYPES_CAPITALISED.map(ciLit).join("|")})${NOT_WORD}(?:,?[ \t]+${NOT_PLACE}${PLACE_WORDS})?(?:,?[ \t]+(?:${AU_STATES}))?,?[ \t]+${POSTCODE}${NOT_WORD}`,
    "gu",
  ),
  /\b(?:P\.?\s?O\.?\s?Box|Post\s+Office\s+Box|Locked\s+Bag|Private\s+Bag)\s+\d+/gi,
  new RegExp(String.raw`\b${UK_POSTCODE}\b`, "g"),
  // A state and postcode on their own: "VIC 3053".
  new RegExp(String.raw`\b(?:${AU_STATES})[ \t]+\d{4}\b`, "g"),
  // A suburb or town and a state code alone on a line, as in a sign-off: "Albany WA".
  new RegExp(
    String.raw`(?<=^|\n)[ \t]*(?!${MONTH_OR_DAY}${NOT_WORD})${NOT_PLACE}${PLACE_WORDS},?[ \t]+(?:${AU_STATES})${NOT_WORD}(?=[ \t]*(?:\r?\n|$))`,
    "gu",
  ),
  // A suburb or city and a 4-digit postcode alone on a line: "Tauranga 3116", "Riccarton, Christchurch 8011".
  new RegExp(
    String.raw`(?<=^|\n)[ \t]*(?!${MONTH_OR_DAY}${NOT_WORD})${NOT_PLACE}${PLACE_WORDS}(?:,[ \t]*${NOT_PLACE}${PLACE_WORDS})?,?[ \t]+\d{4}(?=[ \t]*(?:\r?\n|$))`,
    "gu",
  ),
];
/** A 4-digit AU or NZ postcode given on its own: "postcode 3550", "post code is 9016", "postal code: 2026". */
const POSTCODE_KEYWORD_RE = new RegExp(String.raw`\bpost(?:al)?[ \t]?code(?:['’]s|[ \t]*(?:is|:|-))?[ \t]*(\d{4}|${UK_POSTCODE})\b`, "gi");

/** Street types written in full and capitalised, for streets named in a sentence ("on Saltwater Lane"). */
const STREET_TYPES_FULL = [
  ...STREET_TYPES_CAPITALISED,
  "Street", "Road", "Avenue", "Crescent", "Boulevard", "Highway", "Streets", "Roads", "Avenues", "Lanes", "Drives",
];
const CAP_WORD = String.raw`\p{Lu}[\p{L}\p{M}'’.-]*`;
const NOT_PRONOUN = String.raw`(?!(?:Its|Their|My|Your|His|Her|Our|The|This|That|Which|Every|Each|No|Any)${NOT_WORD})`;
const EXTRA_ADDRESS_RES: { re: RegExp; group?: number }[] = [
  // A street named in a sentence, after a preposition: "number 8 on Saltwater Lane", "she lives off Kōwhai Drive".
  {
    re: new RegExp(
      String.raw`\b(?:number|no\.?|#)\s*\d{1,5}[A-Za-z]?\s+(?:on|in|at|off)\s+${NOT_PRONOUN}${CAP_WORD}(?:\s+${CAP_WORD}){0,2}\s+(?:${STREET_TYPES_FULL.join("|")})${NOT_WORD}`,
      "gu",
    ),
  },
  // Without a number, after a preposition but not "the" (so "on the Desert Road", a highway, stays): "on Saltwater Lane".
  {
    re: new RegExp(
      String.raw`\b(?:on|in|at|off|along|near)\s+(${NOT_PRONOUN}${CAP_WORD}(?:\s+${CAP_WORD}){0,2}\s+(?:${STREET_TYPES_FULL.join("|")}))${NOT_WORD}`,
      "gu",
    ),
    group: 1,
  },
  // A street corner: "the corner of Ashcombe and Tullamore Streets", "cnr Smith St & Brown Rd".
  {
    re: new RegExp(
      String.raw`\b(?:[Cc]orner|[Cc]nr\.?|[Jj]unction|[Ii]ntersection)\s+(?:of\s+)?(${CAP_WORD}(?:\s+${CAP_WORD}){0,2}\s+(?:and|&)\s+${CAP_WORD}(?:\s+${CAP_WORD}){0,2})${NOT_WORD}`,
      "gu",
    ),
    group: 1,
  },
  // A suburb or town right before a UK postcode on the same line: "Hove BN3 4FA".
  { re: new RegExp(String.raw`${NOT_PLACE}${PLACE_WORDS},?[ \t]+${UK_POSTCODE}\b`, "gu") },
];

const UNIT_ONLY = String.raw`(?:${["Unit", "Apartment", "Apt", "Flat", "Suite", "Level", "Lvl", "Shop"].map(ciLit).join("|")})\.?\s*\d+[A-Za-z]?`;
/** One comma part of an address line: "Flat 3", "Seabright House", "41 Westway" (a street with no street type). */
const ADDRESS_PART_RE = new RegExp(
  String.raw`^(?:${UNIT_ONLY}|${HOUSE_NO}\s+${CAP_WORD}(?:\s+${CAP_WORD}){0,3}|${NOT_PLACE}${CAP_WORD}(?:\s+${CAP_WORD}){0,3})$`,
  "u",
);
/** The end of a sentence part that runs into an address: "I'm now at Flat 3", "send it to 41 Westway". */
const ADDRESS_PART_TAIL_RE = new RegExp(
  String.raw`(?:^|\s)(${UNIT_ONLY}|${HOUSE_NO}\s+${CAP_WORD}(?:\s+${CAP_WORD}){0,3}|(?<=\b(?:at|to|is|address)\s)${CAP_WORD}(?:\s+${CAP_WORD}){0,3})$`,
  "u",
);
/** A whole address line with no street type: a house name, a village, an island ("Taigh na Faoileig", "Isle of Skye"). */
const SMALL_WORD = String.raw`(?:na|nan|an|am|a|of|on|the|upon|de|du|la|le|by|in|y|and|&)`;
const ADDRESS_LINE_RE = new RegExp(
  String.raw`^[ \t]*(?:${UNIT_ONLY}[ \t]*,?[ \t]*)?(?:${HOUSE_NO},?[ \t]+)?${NOT_PLACE}${CAP_WORD}(?:[ \t]+(?:${CAP_WORD}|${SMALL_WORD}|\d{1,5}))*[ \t]*,?[ \t]*$|^[ \t]*(?:RD|R\.D\.|Rural Delivery)[ \t]*\d{1,3}[ \t]*,?[ \t]*$`,
  "u",
);

/**
 * The comma parts written just before an address on the same line ("Flat 3, Seabright House, 41 Westway, Hove BN3
 * 4FA"): each is hidden as a span of its own, so a protected id nearby can never drop the whole address.
 */
function addressPartsBefore(text: string, out: Span[]): void {
  for (const s of out.filter((x) => x.type === "address")) {
    let pos = s.start;
    for (let n = 0; n < 4; n++) {
      const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
      const before = text.slice(lineStart, pos);
      const comma = /,\s*$/.exec(before);
      if (!comma) break;
      const head = before.slice(0, comma.index);
      const cut = Math.max(head.lastIndexOf(","), head.lastIndexOf(";"), head.lastIndexOf("("));
      const raw = head.slice(cut + 1);
      const part = raw.trim();
      const partStart = lineStart + cut + 1 + raw.indexOf(part);
      if (part && ADDRESS_PART_RE.test(part)) {
        out.push({ start: partStart, end: partStart + part.length, type: "address" });
        pos = partStart;
        continue;
      }
      const tail = ADDRESS_PART_TAIL_RE.exec(part);
      if (tail) {
        const at = partStart + part.length - tail[1].length;
        out.push({ start: at, end: at + tail[1].length, type: "address" });
      }
      break;
    }
  }
}

/**
 * The lines above an address that sits alone on its line: "Taigh na Faoileig\nArdcorrach\nIsle of Skye\nIV49 9ZX". Up
 * to four address-like lines (no sentence words, no colon), stopping at a blank line.
 */
function addressLinesAbove(text: string, out: Span[]): void {
  const lines: { start: number; s: string }[] = [];
  let pos = 0;
  for (const s of text.split("\n")) {
    lines.push({ start: pos, s: s.replace(/\r$/, "") });
    pos += s.length + 1;
  }
  const lineOf = (i: number) => {
    for (let k = lines.length - 1; k >= 0; k--) if (lines[k].start <= i) return k;
    return 0;
  };
  for (const s of out.filter((x) => x.type === "address")) {
    const k = lineOf(s.start);
    const line = lines[k];
    const outside = line.s.slice(0, s.start - line.start) + line.s.slice(Math.min(line.s.length, s.end - line.start));
    if (!/^[\s,]*$/.test(outside)) continue;
    // Only below a line that carries a postcode ("IV49 9ZX", "Upper Moutere 7173"), not a sign-off town ("Albany WA").
    if (!new RegExp(String.raw`\b(?:\d{4}|${UK_POSTCODE})\b`).test(line.s)) continue;
    for (let j = k - 1, n = 0; j >= 0 && n < 4; j--, n++) {
      const l = lines[j].s;
      if (!l.trim() || !ADDRESS_LINE_RE.test(l)) break;
      // A name under a sign-off ("Kind regards,\nJane Smith") stays a name, and so does a name or company written above
      // a numbered street line ("Anjali Singh\n27 Kahikatea Drive"): the street line starts the address.
      if (j > 0 && SIGNOFF_LINE_RE.test(lines[j - 1].s)) break;
      if (new RegExp(String.raw`^[ \t]*(?:${UNIT_ONLY}|\d)`, "u").test(lines[j + 1].s)) break;
      const lead = l.length - l.trimStart().length;
      out.push({ start: lines[j].start + lead, end: lines[j].start + l.trimEnd().length, type: "address" });
    }
  }
}

// ---------- names ----------

/** Names that are also everyday words: only redacted when written capitalised. */
const COMMON_WORD_NAMES = new Set(
  (
    "will may hope grace rose june april august faith joy mark bill ray dawn summer amber ruby violet jack frank pat sue " +
    "art rich bob drew gene holly iris ivy jade pearl sky rob penny lily daisy heather olive sandy rusty chase grant " +
    "hunter miles dean earl guy lee max nick sonny happy honey angel autumn river storm brook cliff glen dale victor " +
    "harmony melody patience prudence sunny star gay young long white brown green black gray grey rice wood hill page " +
    "king price mason baker cook fisher carter turner walker hall wall bell cross fox hart love may moss park reed " +
    "rich rose shaw stone west day case"
  ).split(" "),
);

/** Capitalised words that are never treated as a self-identified name. */
const NOT_A_NAME = new Set(
  (
    "team mate mates heaps again guys all everyone you so much very lot lots and the a for in on to dispensed care desk " +
    "support monday tuesday wednesday thursday friday saturday sunday january february march april may june july august " +
    "september october november december please sorry hi hello hey dear sir madam there anyway regardless in advance " +
    "doctor doc nurse pharmacy admin customer service i im it its this that thanks thank regards cheers love " +
    "privacy officer patient patients manager clinic pharmacist staff billing accounts reception receptionist " +
    "complaints services customers"
  ).split(" "),
);

/** True when a word is the patient's first or last name, in any case. */
function patientNameWord(patient: Patient | undefined, word: string): boolean {
  const w = word.toLowerCase().replace(/['’]s$/, "");
  return [patient?.firstName, patient?.lastName].some((n) => !!n && n.trim().toLowerCase() === w);
}

function nameRegex(name: string): RegExp {
  const lower = name.toLowerCase();
  const caseSensitive = COMMON_WORD_NAMES.has(lower) || name.length <= 2;
  const body = escapeRe(name).replace(/'/g, "['’]").replace(/\s+/g, "\\s+");
  // A possessive written without the apostrophe ("toms partner", "priyas account") is still the name. With the
  // apostrophe the name already matches on its own and "'s" stays ("[NAME]'s"). Common-word names and very short
  // names keep an exact match, so "wills" or "mays" never become [NAME].
  const possessive = caseSensitive ? "" : "s?";
  return new RegExp(String.raw`(?<![\p{L}\p{N}_])${body}${possessive}(?![\p{L}\p{N}_])`, caseSensitive ? "gu" : "giu");
}

/** One to three capitalised words on one line ("Tom", "Mele Taufa", "Āwhina Te Rangi"). */
const NAME_WORD = String.raw`\p{Lu}[\p{L}\p{M}'’-]+`;
const NAME_WORDS = String.raw`${NAME_WORD}(?:[ \t]+${NAME_WORD}){0,2}`;
const SIGNOFFS = [
  "Thanks in advance", "Thank you so much", "Thank you again", "Many thanks", "Thanks again", "Thanks so much", "Thanks heaps", "Thank you", "Thanks", "Thankyou", "Ta", "Cheers",
  "Kind regards", "Best regards", "Warm regards", "Warmest regards", "Kindest regards", "Regards", "Best wishes",
  "All the best", "Best", "Sincerely", "Yours sincerely", "Yours faithfully", "Yours truly", "Yours", "Love", "Warmly",
  "Take care", "Ngā mihi nui", "Nga mihi nui", "Ngā mihi", "Nga mihi", "Mauri ora", "Noho ora mai", "Nāku noa", "Naku noa",
];
const SIGNOFF_RE = new RegExp(
  String.raw`\b(?:${SIGNOFFS.map(capFlex).join("|")})\s*[,!.:-]?[ \t]*(?:\r?\n\s*)?(${NAME_WORDS})(?=[ \t]*(?:$|\r?\n|[.!,;:)]|x+\b))`,
  "gu",
);
/** A line that is only a sign-off: "Kind regards,", "Thanks!". */
const SIGNOFF_LINE_RE = new RegExp(String.raw`^[ \t]*(?:${SIGNOFFS.map(capFlex).join("|")})[ \t]*[,!.:-]*[ \t]*$`, "u");
const SELF_ID_RES: RegExp[] = [
  new RegExp(
    String.raw`\b(?:${["my name is", "my name's", "name's", "name is", "call me", "i go by", "my full name is"].map(capFlex).join("|")})[ \t]+(${NAME_WORDS})`,
    "gu",
  ),
  new RegExp(String.raw`\b(?:${["this is", "it's", "it is"].map(capFlex).join("|")})\s+(${NAME_WORDS})(?=\s+(?:here|speaking)\b)`, "gu"),
  new RegExp(String.raw`(?:^|\n)[ \t]*[-~][ \t]*(${NAME_WORDS})[ \t]*(?=$|\r?\n)`, "gu"),
  // "From: Sarah Lee" or "From Sarah" at the start of a line (email-style), never mid-sentence.
  new RegExp(String.raw`(?:^|\n)[ \t]*From:?[ \t]+(${NAME_WORDS})`, "gu"),
];
const RELATIONS =
  "husband|wife|partner|mum|mom|mother|dad|father|son|daughter|brother|sister|grandmother|grandfather|nan|nana|nanna|gran|grandma|grandpa|granddad|grandad|koro|kuia|aunt|auntie|aunty|uncle|cousin|friend|carer|niece|nephew|fiance|fiancee|fiancée|boyfriend|girlfriend|flatmate|housemate|neighbour|neighbor|client|patient|stepdad|stepmum|stepmother|stepfather|mate|bestie|colleague|workmate|boss" +
  // An ex, in-laws, and the people who care for someone: "my ex, Siobhan Kelly", "my GP, Farah Tannous".
  "|ex|ex-partner|ex-husband|ex-wife|ex-boyfriend|ex-girlfriend|sister-in-law|brother-in-law|mother-in-law|father-in-law|son-in-law|daughter-in-law|stepson|stepdaughter|grandson|granddaughter|godmother|godfather|GP|doctor|specialist|psychiatrist|psychologist|physio|physiotherapist|counsellor|counselor|therapist|midwife|nurse|dentist|surgeon|oncologist|consultant|vet|case manager|social worker|support worker|landlord|landlady|lawyer|solicitor|employer|manager";
const RELATION_WORDS = new Set(RELATIONS.toLowerCase().split("|"));
const RELATION_RE = new RegExp(
  String.raw`\b(?:[Mm]y|[Oo]ur|[Hh]is|[Hh]er|[Tt]heir)\s+(?:late\s+)?(?:${RELATIONS})\s*,?\s+(${NAME_WORDS})`,
  "gu",
);
const TITLE_RE = new RegExp(String.raw`\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\.?\s+(${NAME_WORDS})`, "gu");
/** "She is Caroline Hollis", "He's Tom": someone named after a pronoun, with no relation word. Capitalised only. */
const PRONOUN_NAME_RE = new RegExp(String.raw`\b(?:[Ss]he|[Hh]e|[Tt]hey)(?:['’]s|\s+is|\s+was|\s+are)\s+(${NAME_WORDS})`, "gu");
/** "Brenda next door takes messages", "Tom from across the road": a neighbour named mid-sentence. */
const NEXT_DOOR_RE = new RegExp(
  String.raw`(${NAME_WORDS})\s+(?:from\s+)?(?:next door|across the (?:road|street|hall|way)|over the road|down the (?:road|street|hall)|upstairs|downstairs|two doors down)\b`,
  "gu",
);
/** Names on a letterbox, a door or a buzzer: "the letterbox on the road says J & R Tamihana". */
const LETTERBOX_RE = new RegExp(
  String.raw`\b(?:letterbox|mailbox|post ?box|door|gate|sign|buzzer|intercom|doorbell|name ?plate)\b[^.\n]{0,30}?\b(?:says|reads|shows|has|said|read|marked|labell?ed|under)\s+((?:\p{Lu}\.?\s*(?:&|and)\s*)*(?:\p{Lu}\.?\s+)*\p{Lu}[\p{L}\p{M}'’-]+(?:\s+\p{Lu}[\p{L}\p{M}'’-]+)?)`,
  "giu",
);
/** A greeting to a named person at the start of the text or a line: "Hi Karen," / "Dear Sally Ng". Capitalised only. */
const GREETING_NAME_RE = new RegExp(
  String.raw`(?:^|\n)[ \t]*(?:${["Hi", "Hello", "Hey", "Dear", "Kia ora", "Morning", "Good morning", "Good afternoon", "Good evening"].map(capFlex).join("|")})[ \t]+(${NAME_WORDS})[ \t]*(?=[,!.:]|\r?\n|$)`,
  "gu",
);

/*
 * Lower-case names, written the way people type on a phone: "my husband jack passed away", "thanks deb", "cheers,
 * grace". One word at a time, filtered against everyday words; over-redacting a rare word is acceptable by design.
 */
const LOWER_WORD = String.raw`\p{L}[\p{L}\p{M}'’-]*\p{L}`;
/** A relation word, then one word and the word after it: "my husband jack passed", "our son nikau is". Any case. */
const RELATION_LOWER_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(?:my|our|his|her|their)\s+(?:late\s+)?(?:${RELATIONS})\s*,?\s+(${LOWER_WORD})(?:[\s,]+(${LOWER_WORD}))?`,
  "giud",
);
/** Sign-offs that are rarely anything else, so they count even mid-sentence ("sorry to bother you thanks deb"). */
const STRONG_SIGNOFFS = [
  "Thanks in advance", "Thank you so much", "Thank you again", "Many thanks", "Thanks again", "Thanks so much",
  "Thanks heaps", "Thank you", "Thanks", "Thankyou", "Cheers", "Kind regards", "Best regards", "Warm regards",
  "Regards", "Ngā mihi", "Nga mihi",
];
/**
 * A sign-off and one or two words at the very end of the text: "thanks deb", "cheers, grace x". Any case. Weaker
 * sign-offs ("Best", "Love", "Yours") count only at the start of a line or after a full stop or comma, so "the best
 * service" is never read as a sign-off.
 */
const SIGNOFF_END_RE = new RegExp(
  String.raw`(?:(?<![\p{L}\p{N}_])(?:${STRONG_SIGNOFFS.map(capFlex).join("|")})|(?:^|(?<=[\n.!?,;][ \t]*))(?:${SIGNOFFS.map(capFlex).join("|")}))` +
    String.raw`[ \t]*[,!.:-]?[ \t]*(?:\r?\n\s*)?(${LOWER_WORD})(?:[ \t]+(${LOWER_WORD}))?[ \t]*[.!]*[ \t]*(?:x+)?[ \t]*$`,
  "iud",
);
/** The last word of the text, for the patient's own first name written in lower case at the end ("... see ya, grace"). */
const LAST_WORD_RE = new RegExp(String.raw`(?<![\p{L}\p{N}_])(${LOWER_WORD})[ \t]*[.!]*[ \t]*(?:x+)?[ \t]*$`, "u");

/**
 * A self-introduction in any case: "hi this is tom smith, ...", "Hi there, I'm Karen, ...", "im jo." Only at the
 * start of the text, a line or a sentence, or straight after a greeting, and only when the one to three words
 * before a comma, full stop or line end are not everyday words ("I'm sorry.", "I'm there.", "this is urgent.").
 */
const INTRO_WORD = String.raw`\p{L}[\p{L}\p{M}'’-]*`;
const INTRO_RE = new RegExp(
  String.raw`(?:^|[\n.!?]|\b(?:hi|hello|hey|hiya|heya|kia ora|m[oō]rena|g['’]?day|good (?:morning|afternoon|evening)|morning)${NOT_WORD})` +
    String.raw`[ \t,!.-]*(?:(?:there|team|all|guys|folks|everyone)[ \t,!.-]+)?` +
    String.raw`(this is|i['’]?m|i am|it['’]?s|it is)[ \t]+(${INTRO_WORD}(?:[ \t]+${INTRO_WORD}){0,2}?)` +
    String.raw`(?=[ \t]*(?:[,.!;:)]|\r?\n|$)|[ \t]+(?:here|speaking|from|and|again|back|writing|messaging|emailing|calling|checking|following|about|with|re)${NOT_WORD})`,
  "giu",
);
/**
 * "<Name> here" at the start of the text, a line or a sentence, or straight after a greeting: "Kia ora, Wiremu here
 * about my order", "Hi team, Priya here." Capitalised names only, never an everyday word ("Everyone here", "Mum here").
 */
const NAME_HERE_RE = new RegExp(
  String.raw`(?:^|[\n.!?]|(?:${["Hi", "Hello", "Hey", "Hiya", "Kia ora", "Morena", "Mōrena", "G'day", "Good morning", "Good afternoon", "Good evening", "Morning", "Dear"].map(capFlex).join("|")})${NOT_WORD})` +
    String.raw`[ \t,!.-]*(?:(?:[Tt]here|[Tt]eam|[Aa]ll|[Gg]uys|[Ff]olks|[Ee]veryone)[ \t,!.-]+)?` +
    String.raw`(\p{Lu}[\p{Ll}\p{M}'’-]+(?:[ \t]+\p{Lu}[\p{Ll}\p{M}'’-]+)?)[ \t]+here${NOT_WORD}`,
  "gu",
);

/** Everyday words that follow "I'm" or "this is" and are never a name. */
const INTRO_COMMON = new Set(
  (
    "a an the my your our his her their me it that this what who so very really quite just still also too not no yes " +
    "there here back home away out in on at off up down over after about for with from to of by again now currently " +
    "nearly almost sorry fine ok okay good great well sure unsure confused worried afraid happy glad sad upset annoyed " +
    "angry frustrated fed disappointed expecting pregnant sick ill unwell tired late early ready done finished gone " +
    "moving leaving travelling traveling writing messaging emailing calling asking wondering trying looking hoping " +
    "waiting relevant cancelled canceled urgent ridiculous serious broken empty new old same different private " +
    "important right wrong correct true false free busy stuck lost locked stressed desperate scared terrified " +
    "anxious nervous grateful thankful sorted delivered overdue due struggling better worse alright used gutted " +
    "stoked chuffed keen annoying frustrating unacceptable concerned interested curious aware having getting going " +
    "coming doing feeling being staying working living paying reaching following confirming checking all everything " +
    "nothing something anything someone none any some one two three first last next only mum dad nan nana koro kuia " +
    "more less most worst best bit lot pretty rather much bitter"
  ).split(/\s+/),
);

/**
 * Everyday words that follow a relation word or a sign-off and are never a name: "my husband passed away", "my mum
 * is", "thanks heaps", "cheers mate". Checked together with INTRO_COMMON and NOT_A_NAME.
 */
const NOT_A_LOWER_NAME = new Set(
  (
    "is was has had have been being does did can could will would should may might must just also still never always " +
    "not no who whom whose which what when where why how and or but nor yet then than as if because since though " +
    "while passed pased past died dies dying away gone went goes sick unwell ill hospital said says told tells asked " +
    "asks wants wanted needs needed tried tries took takes got gets get keeps kept uses used started stopped called " +
    "calls rang rings thinks thought feels felt fell fall found finds reckons wonders cant wont isnt wasnt hasnt " +
    "doesnt didnt can't won't isn't wasn't hasn't doesn't didn't he she they we him her them us their his hers its " +
    "our ours yours mine heaps mate mates guys team all everyone so much very lot lots again you ya anyway cheers " +
    "thanks thank regards love bye soon later tomorrow today tonight yesterday week weeks now in on at to for from " +
    "with of by up out about over into onto off down around through after before during until till via per plus pls " +
    "please xx xxx lol haha ok okay kindly best warm kind many account order orders delivery help support advance " +
    "sorry heart hearts"
  ).split(/\s+/),
);

/** Words after a lower-case name that make it the subject of the sentence: "my husband jack passed away". */
const RELATION_NEXT = new Set(
  (
    "passed pased past died dies is was has had and who said says wants needs asked can could will would does did " +
    "got gets took fell went isn't wasn't hasn't can't won't doesn't didn't isnt wasnt hasnt cant wont doesnt didnt " +
    // "add my partner kirra as someone who's allowed", "my son nikau with me".
    "as with for about to too also on at from here there who's she he they"
  ).split(/\s+/),
);

function isLowerNameWord(w: string | undefined): boolean {
  if (!w || w.length < 2) return false;
  const k = w.toLowerCase().replace(/['’]s$/, "");
  return (
    !NOT_A_LOWER_NAME.has(k) && !INTRO_COMMON.has(k) && !NOT_A_NAME.has(k) && !NOT_SIGNATURE.has(k) && !RELATION_WORDS.has(k)
  );
}

/** Capitalised words that never stand alone as a signature name. */
const NOT_SIGNATURE = new Set(
  (
    "order orders status update help urgent question query request delivery payment refund account plan pause cancel " +
    "change address email login password renewal script prescription appointment re fwd fw sent from my phone mobile " +
    "iphone android ok okay yes no thanks thank cheers regards best kind warm many love yours sincerely"
  ).split(/\s+/),
);
const SIG_NAME_LINE = new RegExp(String.raw`^[ \t]*[-~]?[ \t]*(${NAME_WORDS})[ \t]*[.!,]?[ \t]*(?:x+)?[ \t]*$`, "u");

function isNameWord(w: string): boolean {
  const k = w.toLowerCase().replace(/['’]s$/, "");
  if (NOT_A_NAME.has(k) || NOT_SIGNATURE.has(k)) return false;
  // "CFO", "NSW": an acronym, not a name.
  if (w.length > 1 && w === w.toUpperCase()) return false;
  return true;
}

/**
 * A name alone on the last line, or on the line before a short title or company line ("Sam Porter\nCFO").
 * The first line of the text (an email subject, or the whole message) is never read as a signature.
 */
function signatureCaptures(text: string): { start: number; name: string }[] {
  const lines: { start: number; s: string }[] = [];
  let pos = 0;
  for (const s of text.split("\n")) {
    if (s.trim()) lines.push({ start: pos, s: s.replace(/\r$/, "") });
    pos += s.length + 1;
  }
  if (lines.length < 2) return [];
  const asName = (i: number): { start: number; name: string } | null => {
    if (i < 1) return null;
    const m = SIG_NAME_LINE.exec(lines[i].s);
    if (!m) return null;
    if (!m[1].split(/[ \t]+/).every(isNameWord)) return null;
    return { start: lines[i].start + lines[i].s.indexOf(m[1]), name: m[1] };
  };
  const last = lines.length - 1;
  const onLast = asName(last);
  if (onLast) return [onLast];
  const t = lines[last].s.trim();
  const titleLike = t.length <= 60 && t.split(/\s+/).length <= 6 && /^[\p{Lu}\p{N}+(]/u.test(t) && !/[?]$/.test(t);
  const onPrev = titleLike ? asName(last - 1) : null;
  return onPrev ? [onPrev] : [];
}

/** Trim a captured multi-word name at the first word that is not a name ("Sarah Please" -> "Sarah"). */
function cleanName(raw: string): string | null {
  const words = raw.split(/\s+/);
  const kept: string[] = [];
  for (const w of words) {
    if (NOT_A_NAME.has(w.toLowerCase().replace(/['’]s$/, ""))) break;
    kept.push(w);
  }
  if (kept.length === 0) return null;
  return kept.join(" ").replace(/['’]s$/, "");
}

/**
 * The names written in a text: sign-offs, self-introductions, relations, titles, greetings and signatures (not the
 * patient record). Used to carry a name found in one message of a conversation into the others.
 */
export function findNames(text: string, patient?: Patient): string[] {
  const found = new Set<string>();
  nameSpans(text, patient, [], [], found);
  return [...found];
}

function nameSpans(
  text: string,
  patient: Patient | undefined,
  out: Span[],
  extraNames: readonly string[] = [],
  found?: Set<string>,
): void {
  const names = new Set<string>();
  const direct: Span[] = [];

  const addName = (start: number, name: string) => {
    direct.push({ start, end: start + name.length, type: "name" });
    names.add(name);
    found?.add(name);
    for (const w of name.split(/\s+/)) if (w.length > 1) names.add(w);
  };
  const addCaptured = (re: RegExp) => {
    for (const m of text.matchAll(re)) {
      if (m.index === undefined || !m[1]) continue;
      const cleaned = cleanName(m[1]);
      if (!cleaned) continue;
      addName(m.index + m[0].lastIndexOf(m[1]), cleaned);
    }
  };
  addCaptured(SIGNOFF_RE);
  for (const re of SELF_ID_RES) addCaptured(re);
  addCaptured(RELATION_RE);
  addCaptured(TITLE_RE);
  addCaptured(LETTERBOX_RE);
  // A capitalised name after a pronoun or before "next door", when none of its words is an everyday word.
  for (const re of [PRONOUN_NAME_RE, NEXT_DOOR_RE]) {
    for (const m of text.matchAll(re)) {
      if (m.index === undefined || !m[1]) continue;
      const cleaned = cleanName(m[1]);
      if (!cleaned) continue;
      const words = cleaned.split(/\s+/);
      if (words.some((w) => !isNameWord(w) || INTRO_COMMON.has(w.toLowerCase()) || NOT_A_LOWER_NAME.has(w.toLowerCase()) || RELATION_WORDS.has(w.toLowerCase()))) continue;
      addName(m.index + m[0].indexOf(m[1]), cleaned);
    }
  }
  for (const m of text.matchAll(INTRO_RE)) {
    if (m.index === undefined || !m[2]) continue;
    const words = m[2].split(/[ \t]+/);
    if (words.some((w) => INTRO_COMMON.has(w.toLowerCase()) || NOT_A_NAME.has(w.toLowerCase()))) continue;
    // "it's" is followed by far more everyday words than names ("it's worst mid-morning"): capitalised names only.
    if (/^it/i.test(m[1]) && !words.every((w) => /^\p{Lu}/u.test(w))) continue;
    addName(m.index + m[0].lastIndexOf(m[2]), m[2]);
  }
  for (const m of text.matchAll(NAME_HERE_RE)) {
    if (m.index === undefined || !m[1]) continue;
    const words = m[1].split(/[ \t]+/);
    if (words.some((w) => !isNameWord(w) || INTRO_COMMON.has(w.toLowerCase()) || NOT_A_LOWER_NAME.has(w.toLowerCase()) || RELATION_WORDS.has(w.toLowerCase()))) continue;
    addName(m.index + m[0].lastIndexOf(m[1]), m[1]);
  }
  for (const s of signatureCaptures(text)) addName(s.start, s.name);
  addCaptured(GREETING_NAME_RE);

  // Lower-case names after a relation word: "my husband jack passed away". Only when the word after the name is an
  // everyday word (so the captured word is not the start of a sentence), or the word is the patient's own name.
  for (const m of text.matchAll(RELATION_LOWER_RE)) {
    const at = m.indices?.[1];
    if (!at || !m[1] || !isLowerNameWord(m[1])) continue;
    const next = m[2]?.toLowerCase();
    const own = patientNameWord(patient, m[1]);
    // A capitalised word with nothing after it is a name too ("... my son Nikau").
    const capitalisedAlone = !next && /^\p{Lu}/u.test(m[1]);
    // Otherwise the next word must make the captured one its subject ("my son nikau is"), and the captured word must
    // not look like a verb or an adverb itself ("my daughter lives in", "my mum usually has").
    const subject = !!next && RELATION_NEXT.has(next) && !/(?:ly|ing|ed|s)$/i.test(m[1]);
    if (own || capitalisedAlone || subject) addName(at[0], m[1]);
  }
  // A sign-off and a name at the very end: "thanks deb", "cheers, grace". A second word counts only if it also reads
  // as a name ("thanks deb smith").
  const end = SIGNOFF_END_RE.exec(text);
  const endAt = end?.indices?.[1];
  if (end && endAt && isLowerNameWord(end[1]) && (!end[2] || isLowerNameWord(end[2]))) {
    const stop = end[2] && end.indices?.[2] ? end.indices[2][1] : endAt[1];
    addName(endAt[0], text.slice(endAt[0], stop));
  }

  // The patient's own first name as the last word of the text, in any case ("... cheers grace").
  const first = patient?.firstName?.trim();
  if (first && !/\s/.test(first)) {
    const last = LAST_WORD_RE.exec(text);
    if (last?.index !== undefined && last[1].toLowerCase() === first.toLowerCase()) addName(last.index, last[1]);
  }

  for (const n of extraNames) if (n.trim()) names.add(n.trim());

  if (patient) {
    const first = patient.firstName?.trim();
    const last = patient.lastName?.trim();
    if (first && last) names.add(`${first} ${last}`);
    if (first) names.add(first);
    if (last) names.add(last);
  }

  // Longest names first, so "Jane Smith" is claimed as one span before "Jane" and "Smith".
  const sorted = [...names].filter((n) => n.length > 0).sort((a, b) => b.length - a.length);
  for (const n of sorted) collect(nameRegex(n), text, "name", out);
  out.push(...direct);
}

// ---------- the patient's own record values ----------

const COUNTRY_CODES: Record<string, string> = { AU: "61", NZ: "64", UK: "44" };

/** A record value's letters and digits, each followed by an optional separator ("ZEY0888", "zey 0888", "2928-52842-1"). */
function flexLiteral(core: string, sep: string): string {
  return core
    .split("")
    .map((c) => escapeRe(c))
    .join(sep);
}

/**
 * The patient's health identifiers, email and phone from the record, as literal candidates in any case and with any
 * spacing, so a value typed without a keyword ("ref zey0888 thanks") is still hidden even when no pattern would
 * recognise it.
 */
function recordLiteralSpans(text: string, patient: Patient, out: Span[]): void {
  const ids = patient.identifiers ?? {};
  for (const value of [ids.medicare, ids.nhi, ids.nhs]) {
    const core = value?.replace(/[\s./-]/g, "") ?? "";
    if (core.length < 6) continue;
    // A Medicare number may be written with its one-digit reference number after it ("2928 52842 1/2").
    const irn = /^\d+$/.test(core) ? String.raw`(?:[\s/-]?\d)?` : "";
    collect(
      new RegExp(String.raw`(?<![\p{L}\p{N}_])${flexLiteral(core, String.raw`[\s./-]?`)}${irn}(?![\p{L}\p{N}_])`, "giu"),
      text,
      "health_id",
      out,
    );
  }

  const email = patient.email?.trim();
  if (email) collect(new RegExp(String.raw`(?<![\p{L}\p{N}_.+-])${escapeRe(email)}(?![\p{L}\p{N}_-])`, "giu"), text, "email", out);

  const digits = patient.phone?.replace(/\D/g, "") ?? "";
  if (digits.length >= 8) {
    const cc = COUNTRY_CODES[patient.country ?? patient.address?.country ?? ""];
    const national = digits.startsWith("0") ? digits.slice(1) : digits;
    const lead = digits.startsWith("0")
      ? String.raw`(?:${cc ? String.raw`(?:\+|00)[\s.-]?${cc}[\s.-]?(?:\(0\)[\s.-]?)?|` : ""}\(?0\)?[\s.-]?)`
      : "";
    collect(
      new RegExp(String.raw`(?<![\p{N}+])${lead}${flexLiteral(national, String.raw`[\s.()-]{0,2}`)}(?![\p{N}])`, "gu"),
      text,
      "phone",
      out,
    );
  }
}

// ---------- places ----------

/** Place names that are also everyday words: never redacted on their own, only inside a full address. */
const COMMON_PLACE_WORDS = new Set(
  (
    "central city north south east west upper lower mount point park beach bay hill hills heights island islands " +
    "reading bath sale orange hope wells deal rest march street road lane grove green vale view town village " +
    "harbour port river lake valley plains creek flat junction bridge cross gardens square centre center new old " +
    "st saint great little"
  ).split(" "),
);
const STATE_CODE = new RegExp(String.raw`^(?:${AU_STATES})$`);

function placeOk(place: string): boolean {
  const p = place.trim();
  if (p.length < 4 || /\d/.test(p)) return false;
  if (!/^\p{Lu}/u.test(p)) return false;
  if (STATE_CODE.test(p)) return false;
  return !COMMON_PLACE_WORDS.has(p.toLowerCase());
}

/**
 * The patient's own suburb, city and region from the record ("Ballarat Central" also gives "Ballarat"), plus the
 * suburb or city written under any address found in the message ("Petersham NSW 2049" gives "Petersham"). The
 * message's other mentions of those places ("nothing's turned up here in Ballarat", "moving to Petersham") are
 * hidden too: where someone lives says who they are.
 */
function placeNames(text: string, patient: Patient | undefined, addressSpans: Span[]): string[] {
  const out = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    for (const part of raw.split(/\s*[,\n]\s*/)) {
      const words = part
        .trim()
        .split(/\s+/)
        .filter((w) => w && !STATE_CODE.test(w) && !/\d/.test(w) && !new RegExp(String.raw`^${UK_POSTCODE}$`).test(w));
      if (!words.length || words.length > 3) continue;
      const whole = words.join(" ");
      if (placeOk(whole)) out.add(whole);
      // "Ballarat Central" is also written "Ballarat"; "Mount Maunganui" stays whole.
      if (words.length > 1 && placeOk(words[0]) && !COMMON_PLACE_WORDS.has(words[0].toLowerCase())) out.add(words[0]);
    }
  };
  const a = patient?.address;
  if (a) {
    add(a.suburb);
    if (a.region && !STATE_CODE.test(a.region.trim())) add(a.region);
  }
  for (const s of addressSpans) {
    const piece = text.slice(s.start, s.end);
    // Only the lines and comma parts without a house number: the suburb, town or city.
    for (const part of piece.split(/\s*[,\n]\s*/).slice(1)) add(part);
    if (!/[,\n]/.test(piece)) add(piece);
  }
  return [...out].sort((x, y) => y.length - x.length);
}

function placeSpans(text: string, patient: Patient | undefined, out: Span[]): void {
  const addressSpans = out.filter((s) => s.type === "address");
  for (const place of placeNames(text, patient, addressSpans)) {
    const lit = escapeRe(place).replace(/\s+/g, String.raw`\s+`);
    collect(new RegExp(String.raw`(?<![\p{L}\p{N}_])${lit}${NOT_WORD}`, "giu"), text, "address", out);
  }
}

/**
 * The suburb, city and postcode written after a street in lower case: "5 kowhai st, te aro, wellington 6011", "10
 * downing street london sw1a 2aa". Up to three place parts of one to three words, then a 4-digit or UK postcode (any
 * case), or, when the parts are set off by commas, the end of the sentence or line. Everyday words stop it.
 */
const TAIL_STOP = String.raw`(?:and|but|or|if|so|as|by|on|at|for|from|with|before|after|when|then|the|my|it|its|is|i|im|can|could|would|will|please|pls|thanks|thank|thankyou|cheers|ta|sorry|also|regards|kind|ok|okay|yes|no|asap|today|tomorrow|tonight|now|soon|not|instead|thx|xx|x|hi|hey|which|that|this|where|what|how|who|because|until|since|unless|while|last|next|week|weeks|month|months|day|days|ago|yesterday|morning|afternoon|evening|night|again|too|either|instead|anyway|though)`;
const TAIL_WORD = String.raw`(?!${TAIL_STOP}${NOT_WORD})\p{L}[\p{L}\p{M}'’-]*${NOT_WORD}`;
const TAIL_PART = String.raw`${TAIL_WORD}(?:[ \t]+${TAIL_WORD}){0,2}`;
const ADDRESS_TAIL_LOWER_RE = new RegExp(
  String.raw`^(?:(?:,[ \t]*|[ \t]+)${TAIL_PART}){0,3}(?:,?[ \t]+(?:${AU_STATES}))?,?[ \t]+(?:\d{4}|${UK_POSTCODE})${NOT_WORD}|^(?:,[ \t]*${TAIL_PART}){1,3}(?=[ \t]*(?:[.!?]|\r?\n|$)|[ \t]+${TAIL_STOP}${NOT_WORD})`,
  "iu",
);
/**
 * A lowercase suburb of two words straight after the street, with no comma: "5 smith st south yarra", "1/23 o'connell st
 * north melbourne". Only when the first word is a compass point or a common suburb prefix, so "5 smith st please" stays.
 */
const SUBURB_PREFIX_TAIL_RE = new RegExp(
  String.raw`^[ \t]+(?:north|south|east|west|upper|lower|mount|mt|st|port|glen|new|point|west|little|lake|palm|kings|queens|north ?west|south ?east)[ \t]+${TAIL_WORD}(?:[ \t]+${TAIL_WORD})?`,
  "iu",
);
function extendAddressTail(text: string, spans: Span[]): void {
  for (const s of spans) {
    if (s.type !== "address") continue;
    const m = ADDRESS_TAIL_LOWER_RE.exec(text.slice(s.end, s.end + 120));
    if (m) s.end += m[0].length;
    else if (/(?:st|street|rd|road|ave|avenue|dr|drive|cres|crescent|pl|place|ct|court|tce|terrace|pde|parade|ln|lane|way|cl|close|gr|grove|hwy|highway|blvd|boulevard)\.?$/i.test(text.slice(s.start, s.end))) {
      const sub = SUBURB_PREFIX_TAIL_RE.exec(text.slice(s.end, s.end + 60));
      if (sub) {
        // Keep only the suburb words, not a trailing everyday word ("south yarra please" keeps "please").
        s.end += sub[0].length;
      }
    }
  }
}

/**
 * An organisation named just before an address on the same line, as in "Harbourside Studios, 22 Mount Stuart Walk":
 * a workplace next to an address is as identifying as the address, so the address span grows to cover it.
 */
function extendOrgBeforeAddress(text: string, spans: Span[]): void {
  const ORG = new RegExp(
    String.raw`(?:^|\n|:)[ \t]*(${NOT_PLACE}\p{Lu}[\p{L}\p{M}'’&.-]*(?:[ \t]+(?:&|and|of|the|\p{Lu}[\p{L}\p{M}'’&.-]*)){0,5}),[ \t]*$`,
    "u",
  );
  for (const s of spans) {
    if (s.type !== "address") continue;
    const before = text.slice(Math.max(0, s.start - 80), s.start);
    const m = ORG.exec(before);
    if (m && m.index !== undefined) s.start = s.start - before.length + before.lastIndexOf(m[1]);
  }
}

// ---------- main ----------

export interface RedactOptions {
  /**
   * Names already known from the rest of the conversation (see conversationNames and redactThread), redacted wherever
   * they appear, so "Karen" signed in an earlier message is hidden in this one too.
   */
  names?: readonly string[];
}

export function redact(
  text: string,
  patient?: Patient,
  opts: RedactOptions = {},
): { redactedText: string; redactions: Redaction[] } {
  if (!text) return { redactedText: text ?? "", redactions: [] };
  // Patterns run on a copy with full-width characters from mobile keyboards ("jane＠gmail．com", "０４１２") mapped to
  // their plain forms, one character for one, so every span still points at the original text.
  const original = text;
  text = sameLengthFold(text);

  const protectedSpans: Span[] = [];
  for (const re of PROTECTED) collect(re, text, "other", protectedSpans);

  const candidates: Span[] = [];
  collect(EMAIL_RE, text, "email", candidates);
  for (const re of OBFUSCATED_EMAIL_RES) collect(re, text, "email", candidates);
  providerEmailSpans(text, candidates);
  providerHandleSpans(text, candidates);
  collect(SPACED_EMAIL_RE, text, "email", candidates);
  collect(CARD_RE, text, "card", candidates);
  for (const re of CARD_EXTRA_RES) collect(re, text, "card", candidates, 1);
  for (const re of HEALTH_RES) collect(re, text, "health_id", candidates);
  collect(HEALTH_KEYWORD_RE, text, "health_id", candidates, 1);
  for (const re of HEALTH_EXTRA_RES) collect(re, text, "health_id", candidates, 1);
  for (const re of SOCIAL_HANDLE_RES) collect(re, text, "other", candidates, 1);
  collect(NAME_ON_CARD_RE, text, "name", candidates, 1);
  collect(OTHER_ID_RES[0], text, "other", candidates);
  collect(OTHER_ID_RES[1], text, "other", candidates, 1);
  for (const re of OTHER_ID_RES.slice(2)) collect(re, text, "other", candidates, 1);
  wideCardSpans(text, candidates);
  // Phone and card numbers are also read with a letter O typed for a zero and a small l or capital I for a one
  // ("O412 345 678", "04l2 345 678"), on a copy that changes only those letters, and only next to a digit.
  const digitText = digitLookalikes(text);
  for (const t of digitText === text ? [text] : [text, digitText]) {
    for (const m of t.matchAll(PHONE_RE)) {
      if (m.index !== undefined && validPhone(m[0])) candidates.push({ start: m.index, end: m.index + m[0].length, type: "phone" });
    }
    for (const m of t.matchAll(PHONE_KEYWORD_RE)) {
      if (m.index === undefined || !m[1]) continue;
      const digits = phoneDigits(m[1]);
      if (digits.length < 8 || digits.length > 13) continue;
      const start = m.index + m[0].lastIndexOf(m[1]);
      candidates.push({ start, end: start + m[1].length, type: "phone" });
    }
    if (t !== text) {
      collect(CARD_RE, t, "card", candidates);
      wideCardSpans(t, candidates);
    }
  }
  spokenPhoneSpans(text, candidates);
  dobSpans(text, patient, candidates);
  for (const re of ADDRESS_RES) collect(re, text, "address", candidates);
  for (const { re, group } of EXTRA_ADDRESS_RES) collect(re, text, "address", candidates, group ?? 0);
  collect(POSTCODE_KEYWORD_RE, text, "address", candidates, 1);
  if (patient?.address) {
    // Record values as literals; spaces match any whitespace (line breaks too) and commas are optional, so
    // "Mount Maunganui, Tauranga" in the record also matches "Mount Maunganui\nTauranga" in a message.
    const lit = (s: string | undefined) =>
      s ? escapeRe(s.trim()).replace(/\s*,\s*/g, ",").replace(/\s+/g, String.raw`\s+`).replace(/,/g, String.raw`,?\s*`) : "";
    const { line1, suburb, region, postcode } = patient.address;
    const opt = (s: string | undefined) => (s ? String.raw`(?:,?\s+${lit(s)})?` : "");
    if (line1) {
      // The record's street line, with the suburb, region and postcode when they follow it.
      collect(
        new RegExp(String.raw`${lit(line1)}${opt(suburb)}${opt(region)}${opt(postcode)}${NOT_WORD}`, "giu"),
        text,
        "address",
        candidates,
      );
    }
    if (suburb && postcode) {
      const tail = String.raw`${lit(suburb)}(?:,?\s+${lit(region)})?,?\s+${lit(postcode)}${NOT_WORD}`;
      collect(new RegExp(tail, "giu"), text, "address", candidates);
    }
    // The record postcode wherever it appears on its own ("DOB [DOB], postcode 3550"). A postcode that looks like a
    // year ("2026") is only redacted in the address contexts above, so dates such as "22 September 2026" survive.
    const pc = postcode?.trim();
    if (pc && !/^(?:19|20)\d{2}$/.test(pc)) {
      collect(
        new RegExp(
          String.raw`(?<![\p{L}\p{N}_$£./-])(?<!${MONTH_OR_DAY}\.?,?[ \t]{1,3})${lit(pc)}(?![\p{L}\p{N}_]|[/-]\p{N})`,
          "giu",
        ),
        text,
        "address",
        candidates,
      );
    }
  }
  extendAddressTail(text, candidates);
  extendOrgBeforeAddress(text, candidates);
  addressPartsBefore(text, candidates);
  addressLinesAbove(text, candidates);
  placeSpans(text, patient, candidates);
  if (patient) recordLiteralSpans(text, patient, candidates);
  nameSpans(text, patient, candidates, opts.names ?? []);

  // An IBAN claims its whole span: the card and phone patterns inside it are dropped, so no part of it stays.
  const ibans: Span[] = [];
  for (const re of IBAN_RES) collect(re, text, "other", ibans, 1);
  for (const ib of ibans) {
    for (let i = candidates.length - 1; i >= 0; i--) {
      const c = candidates[i];
      if (c.start < ib.end && ib.start < c.end && c.start >= ib.start && c.end <= ib.end) candidates.splice(i, 1);
    }
    if (!candidates.some((c) => c.start < ib.end && ib.start < c.end)) candidates.push(ib);
  }

  // Some patterns can capture trailing whitespace; trim spans so placeholders sit tight.
  for (const c of candidates) {
    while (c.end > c.start && /\s/.test(text[c.end - 1])) c.end--;
    while (c.start < c.end && /\s/.test(text[c.start])) c.start++;
  }

  const rank = (t: RedactionType) => CLAIM_PRIORITY.indexOf(t);
  candidates.sort((a, b) => rank(a.type) - rank(b.type) || b.end - b.start - (a.end - a.start) || a.start - b.start);

  const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
  const accepted: Span[] = [];
  for (const c of candidates) {
    if (c.end <= c.start) continue;
    if (protectedSpans.some((p) => overlaps(p, c))) continue;
    if (accepted.some((a) => overlaps(a, c))) continue;
    accepted.push(c);
  }

  accepted.sort((a, b) => a.start - b.start);
  let redactedText = "";
  let cursor = 0;
  const counts = new Map<RedactionType, number>();
  for (const s of accepted) {
    redactedText += original.slice(cursor, s.start) + PLACEHOLDERS[s.type];
    cursor = s.end;
    counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  }
  redactedText += original.slice(cursor);

  const redactions: Redaction[] = TYPE_ORDER.filter((t) => counts.has(t)).map((t) => ({
    type: t,
    placeholder: PLACEHOLDERS[t],
    count: counts.get(t) ?? 0,
  }));
  return { redactedText, redactions };
}

/** Total number of details hidden, for trail summaries ("3 details hidden before any AI step"). */
export function redactionTotal(redactions: Redaction[]): number {
  return redactions.reduce((n, r) => n + r.count, 0);
}

/** Every name written anywhere in a conversation: the current message and its earlier entries. */
export function conversationNames(
  thread: readonly Pick<ThreadEntry, "body">[] | undefined,
  current?: string,
  patient?: Patient,
): string[] {
  const names = new Set<string>();
  for (const t of [current ?? "", ...(thread ?? []).map((e) => e.body)]) {
    for (const n of findNames(t, patient)) names.add(n);
  }
  return [...names];
}

/**
 * A conversation's earlier messages as the AI is given them: each one redacted, with every name found anywhere in the
 * conversation (the current message included) hidden in all of them. Pass the current message's text as `current`.
 */
export function redactThread(
  thread: readonly Pick<ThreadEntry, "from" | "body">[] | undefined,
  patient?: Patient,
  current?: string,
): { from: ThreadEntry["from"]; body: string }[] {
  const entries = thread ?? [];
  const names = conversationNames(entries, current, patient);
  return entries.map((e) => ({ from: e.from, body: redact(e.body, patient, { names }).redactedText }));
}
