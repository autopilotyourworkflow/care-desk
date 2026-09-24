/**
 * Plain-words helpers for how the fact check is shown: a fact found in the sources, a fact only the patient wrote
 * ("check first"), an amount worked out from two cited amounts, the lateness line on an order record, and the other
 * recent messages the drafter read. Pure functions (no React), shared by the trail, the desk and the tests.
 * Every patient, order and message is fictional.
 */
import type { CheckResult, FactCheck } from "@/lib/types";

/**
 * The sourceId the fact check gives a fact the patient wrote in their own message (PATIENT_MESSAGE_ID in
 * lib/pipeline/check.ts, mirrored so the trail does not pull the checker into every page; a test keeps them equal).
 * It is never a source, so it is never shown as one.
 */
export const PATIENT_MESSAGE_SOURCE = "PATIENT_MESSAGE";

/** The visible status of a fact only the patient wrote. */
export const CHECK_FIRST_WORDS = "The patient's own words, check first";
/** What a screen reader hears after the fact itself, where the visible words are shortened or hidden. */
export const CHECK_FIRST_SPOKEN = ", from the patient's own message, check first";

export type FactState = "found" | "check_first" | "missing";

/** Found in the sources, found only in the patient's own message (check first), or not found at all. */
export function factState(f: Pick<FactCheck, "found" | "fromPatient" | "sourceId">): FactState {
  if (!f.found) return "missing";
  if (f.fromPatient || f.sourceId === PATIENT_MESSAGE_SOURCE) return "check_first";
  return "found";
}

/** The source to show beside a fact, or undefined: the patient's own message is never shown as a source. */
export function shownSourceId(f: Pick<FactCheck, "found" | "fromPatient" | "sourceId">): string | undefined {
  return factState(f) === "check_first" ? undefined : f.sourceId;
}

/** "Worked out from NZ$162 minus NZ$149" for an amount the checker worked out from two cited ones, else null. */
export function workedOutText(f: Pick<FactCheck, "derivedFrom">): string | null {
  const from = f.derivedFrom?.trim();
  return from ? `Worked out from ${from}` : null;
}

/** How many facts came only from the patient's own message: CheckResult.checkFirst, else a count of the flags. */
export function checkFirstCount(check: CheckResult | null | undefined): number {
  if (!check) return 0;
  return check.checkFirst ?? check.facts.filter((f) => factState(f) === "check_first").length;
}

/** The facts only the patient wrote, in draft order. */
export function checkFirstFacts(check: CheckResult | null | undefined): FactCheck[] {
  return check?.facts.filter((f) => factState(f) === "check_first") ?? [];
}

/** The note above Send when a detail in the reply comes only from the patient's own message, else null. */
export function checkFirstNote(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "1 detail comes from the patient's own message. Check it before sending."
    : `${n} details come from the patient's own message. Check them before sending.`;
}

/** "Fact check passed: ..." for a check with no missing fact and no banned phrase. */
export function passedHeadline(check: CheckResult): string {
  const n = check.facts.length;
  if (n === 0) return "Fact check passed: no dates, amounts or order numbers to check";
  const own = checkFirstCount(check);
  if (own === 0) return `Fact check passed: ${n === 1 ? "the 1 fact matches" : `all ${n} facts match`} the sources`;
  const rest = n - own;
  const ownPart = `${own} ${own === 1 ? "is" : "are"} the patient's own words`;
  if (rest === 0) return `Fact check passed: ${n === 1 ? "the 1 fact is" : `all ${n} facts are`} the patient's own words`;
  return `Fact check passed: ${rest} ${rest === 1 ? "fact matches" : "facts match"} the sources, ${ownPart}`;
}

/** "Facts in the draft: 2 of 3 found in the sources, 1 from the patient's own message", for the fact table's name. */
export function factsCaption(check: CheckResult): string {
  const n = check.facts.length;
  const found = check.facts.filter((f) => factState(f) === "found").length;
  const own = checkFirstCount(check);
  return `Facts in the draft: ${found} of ${n} found in the sources${own ? `, ${own} from the patient's own message` : ""}`;
}

/**
 * The past-ETA line the retrieval step appends to an order record (lateNoteText in lib/pipeline/retrieve.ts: "2
 * business days past its estimated delivery date as of this message (weekends not counted)"), split off so it can be
 * shown as its own plain line. A test keeps the pattern in step with lateNoteText.
 */
const LATE_NOTE = /;\s*(\d+ business days? past its estimated delivery date as of this message \(weekends not counted\))\s*$/;

export function splitLateNote(text: string): { text: string; late?: string } {
  const m = LATE_NOTE.exec(text);
  if (!m) return { text };
  return { text: text.slice(0, m.index), late: m[1] };
}

/**
 * The lateness line for one order, read from the order record the pipeline looked up for this message (so it says what
 * the drafter was told, as of the message), or undefined when that order was not looked up or is not late.
 */
export function orderLateNote(
  result: { sources?: { records: { id: string; kind: string; text: string }[] } },
  orderId: string,
): string | undefined {
  const record = result.sources?.records.find((s) => s.kind === "order" && s.id === orderId);
  return record ? splitLateNote(record.text).late : undefined;
}

/** The lead-in before the other recent messages the drafter read as context, or null when there were none. */
export function recentMessagesLead(ids: readonly string[] | undefined): string | null {
  if (!ids?.length) return null;
  return ids.length === 1
    ? "The draft also read this patient's other recent message:"
    : "The draft also read this patient's other recent messages:";
}
