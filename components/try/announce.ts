/**
 * What the Try page says out loud, with no UI. One persistent live region on the page reads `runAnnouncement(state)`:
 * the region exists from the first render and only its text changes, so screen readers announce each change once
 * (a region inserted with its text already in place is often not read at all).
 * The visible fallback notice and the spoken line share `fallbackCopy`, so they never say different things.
 */
import type { PipelineResult } from "@/lib/types";
import { STEP_LABEL } from "@/lib/format";
import { verdictText } from "@/components/trail/outcome";
import { idiomNote } from "./examples";
import { localClock, untilText, usedAnyModel, type Fallback } from "./live";
import type { RunState } from "./useLiveRun";

export function isStoppedByRules(result: PipelineResult): boolean {
  return result.trail.some((s) => s.status === "stopped");
}

/** Why the live AI did not answer, in one line. */
export function fallbackReason(fallback: Fallback): string {
  switch (fallback.kind) {
    case "limited": {
      const at = localClock(fallback.resetAt);
      const until = untilText(fallback.resetAt);
      return fallback.reason === "visitor"
        ? `You have used this hour's live tries. They come back at ${at} your time (${until}).`
        : `Today's live AI budget is used up. It comes back at ${at} your time (${until}).`;
    }
    case "unreachable":
      return "The live AI is taking a break right now.";
    case "error":
      return fallback.message ?? "The live AI did not answer this time.";
    default:
      return "The live AI is resting right now.";
  }
}

/** The fallback notice's title. Calm on purpose: nothing is broken, and the safety rules still ran. */
export const FALLBACK_TITLE = "Running without the live AI";

/** The fallback notice's words: a title, why, and what the visitor is looking at instead. */
export function fallbackCopy(
  fallback: Fallback,
  engine: "live" | "browser",
  result?: PipelineResult,
): { title: string; reason: string; what: string } {
  const where = engine === "browser" ? " in your browser" : "";
  let what: string;
  if (!result) {
    what = `The checks are running${where}, with a simple built-in stand-in for Claude. The safety rules are the real ones.`;
  } else if (!usedAnyModel(result)) {
    what = isStoppedByRules(result)
      ? "It made no difference here: the safety rules stopped this message before any AI would see it."
      : `The safety rules and checks ran${where}, with no AI.`;
  } else if (result.draft?.text) {
    what =
      "A simple built-in stand-in for Claude wrote this sample reply. The safety rules and the fact check below are the real ones and ran exactly as on the desk.";
  } else {
    what = `A simple built-in stand-in for Claude sorted it${where}. The safety rules are the real ones.`;
  }
  return { title: FALLBACK_TITLE, reason: fallbackReason(fallback), what };
}

/** The visible text of the failed-run notice, also what is read out. */
export const FAILED_TITLE = "The checks could not run";
export const FAILED_BODY = "Something stopped the page from loading the safety rules. Your message is still in the box.";

/**
 * The single line the page's live region holds for this run state:
 *  - idle: nothing;
 *  - running: "Running the checks.", or why the live AI is not answering when the page falls back, then each step as
 *    it lands ("Safety rules: ...");
 *  - done: "Finished." and the verdict, plus the fallback reason when it only became known at the end;
 *  - failed: the failure notice's words.
 * The browser fallback is announced while it runs, so the finished line does not repeat it.
 */
export function runAnnouncement(state: RunState): string {
  switch (state.phase) {
    case "idle":
      return "";
    case "failed":
      return `${FAILED_TITLE}. ${FAILED_BODY}`;
    case "running": {
      const last = state.steps[state.steps.length - 1];
      if (last) return `${STEP_LABEL[last.id]}: ${last.summary}`;
      if (state.fallback) {
        const f = fallbackCopy(state.fallback, state.engine);
        return `${f.title}. ${f.reason} ${f.what}`;
      }
      return "Running the checks.";
    }
    case "done": {
      const parts = ["Finished.", verdictText(state.result)];
      const idiom = idiomNote(state.result);
      if (idiom) parts.push(idiom);
      // A browser run started with its fallback already announced; a live run learns it only now.
      if (state.fallback && state.engine === "live") {
        const f = fallbackCopy(state.fallback, state.engine, state.result);
        parts.push(`${f.title}. ${f.reason}`);
      }
      return parts.join(" ");
    }
  }
}
