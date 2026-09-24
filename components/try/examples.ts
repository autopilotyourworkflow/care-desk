/**
 * One-click example messages for the live box, and short, plain summaries of each sample patient's record.
 * The routine example is chosen per patient so the draft can cite something real in that record.
 * Every patient here is fictional.
 */
import type { Patient, PipelineResult, Route } from "@/lib/types";
import { formatCalendarDate, formatDate, formatMoney } from "@/lib/format";

export type ExampleKind = "routine" | "clinical" | "idiom" | "person";

export interface Example {
  id: ExampleKind;
  label: string;
  text: string;
  /** Shown under the trail after this exact example runs, when it ended on one of these routes. */
  note?: string;
  noteWhen?: Route[];
}

const ROUTINE_BY_PATIENT: Record<string, { label: string; text: string }> = {
  "PT-1001": { label: "Where's my order?", text: "Hi, has my order shipped yet? When should it arrive?" },
  "PT-1031": { label: "A billing question", text: "Hi, why was I charged more in September?" },
  "PT-1043": { label: "A script renewal", text: "My script has run out. How do I get a repeat?" },
};

const SHARED: Example[] = [
  {
    id: "clinical",
    label: "A medicine question",
    text: "Is it OK to take my oil with my sleeping tablets?",
    note: "Questions about medicines always go to a clinician, with no AI reply written.",
    noteWhen: ["clinician", "urgent"],
  },
  {
    id: "idiom",
    label: "An idiom that sounds alarming",
    text: "I'm dying to get my order, it's been ages!",
    // No note here: idiomNote() explains any stop on an idiom-prone word, typed or picked, right above the trail.
  },
  {
    id: "person",
    label: "Asks for a person",
    text: "Can I talk to a real person please?",
    note: "Asking for a person always reaches a person. No AI draft is written.",
    noteWhen: ["person"],
  },
];

/** Safety rules that match words often used as a figure of speech ("dying to", "killing me"). See lib/pipeline/rules.ts. */
const IDIOM_PRONE_RULES: ReadonlySet<string> = new Set(["crisis.idiom_dying", "crisis.idiom_kill_me"]);

/**
 * When the safety rules stopped a message only because of an idiom-prone word, one line saying the stop is deliberate.
 * Undefined when anything else matched too (then the stop is not a likely false alarm, and nothing should suggest it is).
 */
export function idiomNote(result: PipelineResult): string | undefined {
  if (!result.trail.some((s) => s.id === "rules" && s.status === "stopped")) return undefined;
  const safety = result.rules.hits.filter((h) => h.category !== "stop_sending");
  if (safety.length === 0 || !safety.every((h) => IDIOM_PRONE_RULES.has(h.ruleId.replace(/^thread\./, "")))) return undefined;
  const phrase = safety.find((h) => h.start >= 0)?.phrase ?? safety[0].phrase;
  const word = phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1).toLowerCase() : "This word";
  return `Flagged on purpose. "${word}" is often a figure of speech, but the rules never guess: a clinician clears a false alarm in a minute, and a miss is never acceptable.`;
}

export function examplesFor(patientId: string): Example[] {
  const r = ROUTINE_BY_PATIENT[patientId] ?? ROUTINE_BY_PATIENT["PT-1001"];
  return [
    { id: "routine", label: r.label, text: r.text, note: "A routine question: the draft uses only this patient's record and the written policy.", noteWhen: ["draft"] },
    ...SHARED,
  ];
}

export function exampleForText(patientId: string, text: string): Example | undefined {
  return examplesFor(patientId).find((e) => e.text === text);
}

export const COUNTRY_NAME: Record<Patient["country"], string> = {
  AU: "Australia",
  NZ: "New Zealand",
  UK: "United Kingdom",
};

export function shortName(p: Pick<Patient, "firstName" | "lastName">): string {
  return `${p.firstName} ${p.lastName.charAt(0)}.`;
}

/** "Brunswick, Australia" */
export function placeLine(p: Patient): string {
  return `${p.address.suburb}, ${COUNTRY_NAME[p.country]}`;
}

function newest<T>(items: T[], at: (x: T) => string): T | undefined {
  return items.slice().sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)))[0];
}

/** The one fact most worth knowing before writing as this patient: where their latest order is. */
export function orderLine(p: Patient): string {
  const o = newest(p.orders, (x) => x.placedAt);
  if (!o) return "No orders yet";
  switch (o.status) {
    case "shipped":
      return o.eta
        ? `Order ${o.id} shipped ${formatDate(o.shippedAt ?? o.placedAt, p.timezone, "dayShort")}, due ${formatCalendarDate(o.eta, { noYear: true })}`
        : `Order ${o.id} shipped ${formatDate(o.shippedAt ?? o.placedAt, p.timezone, "dayShort")}`;
    case "delivered":
      return `Order ${o.id} delivered ${formatDate(o.deliveredAt ?? o.placedAt, p.timezone, "dayShort")}`;
    case "dispensing":
      return `Order ${o.id} being dispensed`;
    case "script_pending":
      return `Order ${o.id} waiting on a script`;
    case "on_hold":
      return `Order ${o.id} on hold`;
    default:
      return `Order ${o.id} cancelled`;
  }
}

/** Plan price and the next booked appointment. */
export function planLine(p: Patient): string {
  const price = `${formatMoney(p.plan.monthlyPrice, p.plan.currency, { explicit: true })} a month`;
  const next = p.appointments
    .filter((a) => a.status === "booked")
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  return next ? `${price}, next consult ${formatDate(next.at, p.timezone, "dayShort")}` : price;
}
