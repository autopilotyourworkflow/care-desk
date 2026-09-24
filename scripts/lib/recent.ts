/**
 * The separate messages a script run passes to runPipeline (RunOptions.recentMessages), shared by npm run precompute
 * and scripts/cc-run.ts so both build the same drafter input.
 *
 *  - A desk message (before MSG-0901) sees the same patient's other desk messages from the days before it
 *    (recentMessagesFor). runPipeline then leaves out any the deterministic rules would stop (withheldSeparateMessage).
 *  - A red-team message (MSG-0901 onwards) sees nothing. The red-team slice is 128 separate scenarios that borrow desk
 *    patient ids, so another red-team message with the same id is a different story, not this patient's history
 *    (rehearsal round 3, P1: MSG-0975 was shown the crisis message MSG-0967, MSG-0990 the death report MSG-0921 about a
 *    different named person). Each red-team case stands alone, as in round 2, and scripts/eval.ts scores it on its own.
 */
import type { PatientMessage } from "../../lib/types";
import { recentMessagesFor } from "../../lib/pipeline/run";
import { isRedTeam } from "./review-cases";

export function scriptRecentMessages(message: PatientMessage, messages: readonly PatientMessage[]): PatientMessage[] {
  if (isRedTeam(message.id)) return [];
  return recentMessagesFor(
    message,
    messages.filter((m) => !isRedTeam(m.id)),
  );
}
