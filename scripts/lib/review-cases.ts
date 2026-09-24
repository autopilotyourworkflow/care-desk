/**
 * The cases the eval scores, rebuilt for the rehearsal's reviewer packet (scripts/cc-run.ts review). It mirrors the
 * scoring in scripts/eval.ts step by step, so a reviewer sees the same differences the eval reports:
 *  - desk results are scored after patient-level holds (applyPatientHolds), red-team results on their own;
 *  - a desk label is adjusted for the patient's other messages: a labelled death report makes the patient's other
 *    messages urgent with a hold (withdrawn), and a labelled urgent report (or a clinician case with a hold) makes the
 *    patient's other draft labels person (held for a person);
 *  - the category compared is resultCategory(result), as in the eval.
 * Each case also keeps the message's own result and the label as written, so the per-message detail stays visible.
 * Keep this in step with scripts/eval.ts (tests/review-cases.test.ts pins the rules above).
 */
import type { Category, PatientMessage, PipelineResult, Route, TestLabel } from "../../lib/types";
import { applyPatientHolds, resultCategory } from "../../lib/pipeline";

/** The held-out red-team slice (as in scripts/eval.ts): test inputs only, never in the desk queue. */
export const RED_TEAM_FIRST = "MSG-0901";
export const isRedTeam = (messageId: string) => messageId >= RED_TEAM_FIRST;

export interface ReviewCase {
  messageId: string;
  /** The label the eval scores against: the label as written, adjusted for the patient's other messages. */
  label: TestLabel;
  /** The label as written in data/testset.json. */
  labelAsWritten: TestLabel;
  /** The result the eval scores: after patient-level holds for a desk message, the message's own result otherwise. */
  result: PipelineResult;
  /** The message's own result, before patient-level holds. */
  ownResult: PipelineResult;
  /** The message whose labelled death report withdrew this one, if any. */
  withdraw?: string;
  /** The message whose labelled urgent report holds this one for a person, if any. */
  heldFor?: string;
  got: { category?: Category; route: Route; holdOrders: boolean };
  routeCorrect: boolean;
  categoryCorrect: boolean;
}

export function reviewCases(
  results: PipelineResult[],
  messages: PatientMessage[],
  labels: TestLabel[],
): { cases: ReviewCase[]; missing: string[] } {
  const byId = new Map(results.map((r) => [r.messageId, r]));
  const patientOfMessage = new Map(messages.map((m) => [m.id, m.patientId]));
  const deskResults = results.filter((r) => !isRedTeam(r.messageId));
  const deskMessages = messages.filter((m) => !isRedTeam(m.id));
  const effective = new Map(applyPatientHolds(deskResults, deskMessages).map((r) => [r.messageId, r]));

  const deathReport = new Map<string, string>();
  const urgentReport = new Map<string, string>();
  for (const l of labels) {
    if (isRedTeam(l.messageId)) continue;
    const pid = patientOfMessage.get(l.messageId);
    if (!pid) continue;
    if (l.expectedCategory === "bereavement" && l.expectedRoute === "urgent") {
      if (!deathReport.has(pid)) deathReport.set(pid, l.messageId);
    } else if (l.expectedRoute === "urgent" || (l.expectedRoute === "clinician" && l.mustHold)) {
      if (!urgentReport.has(pid)) urgentReport.set(pid, l.messageId);
    }
  }
  const expectFor = (label: TestLabel): { label: TestLabel; withdraw?: string; heldFor?: string } => {
    if (isRedTeam(label.messageId)) return { label };
    const pid = patientOfMessage.get(label.messageId);
    const death = pid ? deathReport.get(pid) : undefined;
    if (death && death !== label.messageId && label.expectedCategory !== "bereavement") {
      const note = `Withdrawn: ${death} reports that the patient has died, so nothing may be sent to the patient.`;
      return {
        label: { ...label, expectedRoute: "urgent", mustHold: true, note: label.note ? `${label.note} ${note}` : note },
        withdraw: death,
      };
    }
    const report = pid ? urgentReport.get(pid) : undefined;
    if (report && report !== label.messageId && label.expectedRoute === "draft") {
      const note = `Held for a person: the patient reported something urgent in ${report}, so no draft is ready to send until a clinician has been in touch.`;
      return { label: { ...label, expectedRoute: "person", note: label.note ? `${label.note} ${note}` : note }, heldFor: report };
    }
    return { label };
  };

  const cases: ReviewCase[] = [];
  const missing: string[] = [];
  for (const original of labels) {
    const own = byId.get(original.messageId);
    const r = (isRedTeam(original.messageId) ? undefined : effective.get(original.messageId)) ?? own;
    if (!r || !own) {
      missing.push(original.messageId);
      continue;
    }
    const { label, withdraw, heldFor } = expectFor(original);
    const got = { category: resultCategory(r), route: r.route, holdOrders: r.holdOrders };
    cases.push({
      messageId: original.messageId,
      label,
      labelAsWritten: original,
      result: r,
      ownResult: own,
      withdraw,
      heldFor,
      got,
      routeCorrect: r.route === label.expectedRoute,
      categoryCorrect: got.category === label.expectedCategory,
    });
  }
  return { cases, missing };
}
