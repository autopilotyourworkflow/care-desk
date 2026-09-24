/**
 * One-line answers to "what happened to this message?", shared by the full trail, the mini trail and any queue row.
 * Pure functions over a PipelineResult, safe on the server and in the browser.
 */
import type { Category, PipelineResult, SafetyCategory } from "@/lib/types";
import { plural, stopReasonLabel } from "@/lib/format";
import { isLivingPatientReport } from "@/lib/pipeline/death";

/** Types that always go to a person, whatever the sorter says (PERSON_CATEGORIES in lib/pipeline/run.ts). */
const PERSON_TYPES: readonly Category[] = ["wants_human", "complaint", "privacy_request", "other"];

/** The sorter's confidence bar for a draft (DEFAULT_CONFIDENCE_THRESHOLD in lib/pipeline/run.ts). */
const CONFIDENCE_BAR = 0.75;

/** Most serious first, matching the pipeline, so a message with several hits leads with the worst one. */
export const SAFETY_ORDER: readonly SafetyCategory[] = ["crisis", "bereavement", "adverse_event", "side_effect", "clinical_question"];

/**
 * The reason for a stop, from the rule hits (or the sorter when it made the call).
 * "Side effect and clinical question", "Bereavement, asked to stop deliveries", and for a living patient's report
 * "Adverse event and clinical question, and it mentions a death".
 */
export function stopReason(result: PipelineResult): string {
  const hits = result.rules.hits;
  const cats = new Set<Category | "stop_sending">(hits.map((h) => h.category));
  // The living patient writing about someone else's death (MSG-0172): their own care leads, and the death is named
  // last as a mention, the same reading as the desk rail and the clinician screen (lib/pipeline/death.ts).
  const living = isLivingPatientReport(hits);
  // Sentence case: only the first label keeps its capital ("Adverse event and side effect").
  const safety = SAFETY_ORDER.filter((c) => cats.has(c) && !(living && c === "bereavement")).map((c, i) =>
    i === 0 ? stopReasonLabel(c) : stopReasonLabel(c).toLowerCase(),
  );
  if (safety.length) {
    let main = safety.length > 1 ? `${safety.slice(0, -1).join(", ")} and ${safety[safety.length - 1]}` : safety[0];
    if (living) main += ", and it mentions a death";
    return cats.has("stop_sending") ? `${main}, ${stopReasonLabel("stop_sending")}` : main;
  }
  // A patient writing about a relative's death with nothing else to flag (MSG-0120): the death still names the stop.
  if (living && cats.has("bereavement")) {
    const main = stopReasonLabel("bereavement");
    return cats.has("stop_sending") ? `${main}, ${stopReasonLabel("stop_sending")}` : main;
  }
  if (result.sort) return stopReasonLabel(result.sort.category);
  return "Safety rule matched";
}

/**
 * True when the built-in stand-in for Claude (the "mock" sorter or drafter) produced part of this result. Such a run plays the
 * part of the live AI in a sample, so it is not a fallback, even though the pipeline marks it deterministic_only.
 */
export function usedStandIn(result: Pick<PipelineResult, "models">): boolean {
  return [result.models.sort, result.models.draft].some((m) => typeof m === "string" && m.startsWith("mock"));
}

/**
 * The note the pipeline appends to a step's summary when the stand-in played that step (SAMPLE_RUN_NOTE in
 * lib/pipeline/run.ts, mirrored here so the trail does not pull the pipeline into every page; a test keeps the two
 * equal). The trail shows it as a small "Sample" tag instead of repeating the sentence on every row.
 */
export const PIPELINE_SAMPLE_NOTE = "Sample run: a simple built-in stand-in for Claude.";

/** A step summary without the pipeline's sample note, and whether it carried one. */
export function splitSampleNote(summary: string): { text: string; sample: boolean } {
  const at = summary.lastIndexOf(PIPELINE_SAMPLE_NOTE);
  if (at < 0) return { text: summary, sample: false };
  const text = (summary.slice(0, at) + summary.slice(at + PIPELINE_SAMPLE_NOTE.length)).replace(/\s+/g, " ").trim();
  return { text, sample: true };
}

/**
 * A check that still ran after a safety stop (the sorter looking for anything more urgent) is part of the stop, not
 * the next step: it gets this title in place of "Sorted by type", a neutral icon and quiet text.
 */
export const AFTER_STOP_TITLE = "Double-checked for anything urgent";

const AFTER_STOP_LEAD = /^Checked for anything more urgent:\s*/i;

/** That check's summary without the lead the new title already says: "Nothing found, so it stays with a clinician." */
export function afterStopSummary(summary: string): string {
  if (!AFTER_STOP_LEAD.test(summary)) return summary;
  const rest = summary.replace(AFTER_STOP_LEAD, "");
  return rest ? rest[0].toUpperCase() + rest.slice(1) : summary;
}

/** The AI steps really did not run (the live fallback): rules only. Never true for a stand-in sample run. */
export function isResting(result: Pick<PipelineResult, "mode" | "models">): boolean {
  return result.mode === "deterministic_only" && !usedStandIn(result);
}

/** Where the trail stopped, in words: "the safety rules" or "the sorter". Undefined when it did not stop. */
export function stoppedAtText(result: PipelineResult): string | undefined {
  const at = result.trail.find((s) => s.status === "stopped")?.id;
  if (at === "rules") return "the safety rules";
  if (at === "sort") return "the sorter";
  return undefined;
}

/** Outcome line under the mini trail: what the person will find. */
export function outcomeText(result: PipelineResult): string {
  switch (result.route) {
    case "draft":
      return "Checked draft ready. A person reviews it, then sends.";
    case "person":
      return result.check && !result.check.passed
        ? "Draft blocked by the fact check. A person writes this one."
        : "A person writes this reply.";
    case "clinician":
      return "No AI reply. A clinician will answer.";
    case "urgent":
      return "No AI reply. A clinician answers first.";
  }
}

/**
 * The trail's verdict, readable in three seconds:
 *   "Checked draft ready. A person reviews it, then sends."
 *   "Draft blocked: 1 fact not in the sources. A person writes this reply."
 *   "Stopped at the safety rules: Clinical question. No AI reply."
 */
export function verdictText(result: PipelineResult): string {
  if (result.route === "clinician" || result.route === "urgent") {
    const where = stoppedAtText(result);
    return `${where ? `Stopped at ${where}` : "Stopped"}: ${stopReason(result)}. No AI reply.`;
  }
  if (result.route === "person" && result.check && !result.check.passed) {
    const missing = result.check.facts.filter((f) => !f.found).length;
    const banned = result.check.banned.length;
    const why = [
      missing > 0 ? `${plural(missing, "fact")} not in the sources` : "",
      banned > 0 ? `${plural(banned, "phrase")} not allowed` : "",
    ]
      .filter(Boolean)
      .join(" and ");
    return `Draft blocked${why ? `: ${why}` : ""}. A person writes this reply.`;
  }
  if (result.route === "person") {
    if (result.draft?.declined) return "The AI declined to draft. A person writes this reply.";
    if (isResting(result)) return "AI resting, so no draft. A person writes this reply.";
    const sort = result.sort;
    if (sort && sort.confidence < CONFIDENCE_BAR) return "The sorter was not sure enough to draft. A person writes this reply.";
    if (sort && PERSON_TYPES.includes(sort.category)) return "A person handles this type of message, so no AI draft.";
    return "No AI draft. A person writes this reply.";
  }
  return outcomeText(result);
}

/**
 * A patient-level lock from the desk queue (QueueLock in lib/fixtures/queue.ts fits this shape): another message from
 * the same patient reports a death, or something urgent. It overrides the per-message verdict, which cannot know.
 */
export interface TrailLock {
  kind: "withdrawn" | "check_clinician";
  /** One plain sentence for the agent, shown under the verdict when given. */
  detail?: string;
}

/** The verdict for a locked item: "Held: check with clinician first. ..." or "Withdrawn: ...". */
export function lockedVerdict(lock: TrailLock): string {
  return lock.kind === "withdrawn"
    ? "Withdrawn: a death was reported for this patient, so nothing is sent."
    : "Held: check with clinician first. Send stays off until a clinician has been in touch.";
}
