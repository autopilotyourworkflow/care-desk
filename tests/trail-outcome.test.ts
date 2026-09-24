/**
 * The trail's one-line stop reason agrees with the desk rail and the clinician screen on whose death a message reports
 * (lib/pipeline/death.ts). Every patient and message is fictional.
 */
import { describe, expect, it } from "vitest";
import resultsData from "@/data/results.json";
import type { PipelineResult, ResultsFile, RuleHit } from "@/lib/types";
import {
  AFTER_STOP_TITLE,
  PIPELINE_SAMPLE_NOTE,
  afterStopSummary,
  splitSampleNote,
  stopReason,
  verdictText,
} from "@/components/trail/outcome";
import { SAMPLE_RUN_NOTE } from "@/lib/pipeline/run";
import { LIVING_PATIENT_RULE_ID, RELATIVE_DEATH_RULE_ID } from "@/lib/pipeline/death";

const RESULTS = (resultsData as unknown as ResultsFile).results;
const byId = (id: string) => RESULTS.find((r) => r.messageId === id)!;

const hit = (ruleId: string, category: RuleHit["category"], start = 0): RuleHit => ({ ruleId, category, phrase: "x", start, end: start + 1 });
const urgent = (hits: RuleHit[]): PipelineResult => ({ ...byId("MSG-0172"), sort: undefined, rules: { matched: true, hits } });

describe("stopReason: whose death is it?", () => {
  it("MSG-0172 (a living patient whose brother died) leads with her own care and names the death last", () => {
    const r = byId("MSG-0172");
    const reason = stopReason(r);
    expect(reason).toMatch(/^Adverse event/);
    expect(reason).toMatch(/, and it mentions a death$/);
    expect(reason).not.toMatch(/bereavement/i);
    expect(verdictText(r)).toMatch(/^Stopped at the safety rules: Adverse event.*mentions a death\. No AI reply\.$/);
  });

  it("a death with no living-patient signal still leads as a bereavement (the safe side)", () => {
    const reason = stopReason(urgent([hit("bereavement.died", "bereavement"), hit("adverse.more", "adverse_event", 10)]));
    expect(reason).toBe("Bereavement and adverse event");
  });

  it("MSG-0120 (Mele writing about her father's death) still names the stop a bereavement, never 'Safety rule matched'", () => {
    const r = byId("MSG-0120");
    expect(r.rules.hits.some((h) => h.ruleId === RELATIVE_DEATH_RULE_ID)).toBe(true);
    expect(stopReason(r)).toBe("Bereavement");
  });

  it("the living-patient hit alone, with no death mentioned, reads as a plain adverse event", () => {
    expect(stopReason(urgent([hit(LIVING_PATIENT_RULE_ID, "adverse_event")]))).toBe("Adverse event");
  });
});

describe("the trail after a stop, and the sample note", () => {
  it("mirrors the pipeline's sample note exactly, so the trail can turn it into a tag", () => {
    expect(PIPELINE_SAMPLE_NOTE).toBe(SAMPLE_RUN_NOTE);
  });

  it("takes the sample note off a step summary and says it was there", () => {
    expect(splitSampleNote(`Order status, confidence 0.92. ${SAMPLE_RUN_NOTE}`)).toEqual({
      text: "Order status, confidence 0.92.",
      sample: true,
    });
    expect(splitSampleNote("No personal details found to hide")).toEqual({ text: "No personal details found to hide", sample: false });
  });

  it("drops the lead the new title already says from the check after a stop", () => {
    expect(afterStopSummary("Checked for anything more urgent: nothing found, so it stays with a clinician.")).toBe(
      "Nothing found, so it stays with a clinician.",
    );
    expect(afterStopSummary("Something else")).toBe("Something else");
    expect(AFTER_STOP_TITLE).not.toMatch(/[\u2013\u2014]/);
  });

  it("every clinician-level stop in the shipped results has that check, so the neutral row covers them all", () => {
    const stops = RESULTS.filter((r) => r.route === "clinician" && r.trail.find((s) => s.id === "rules")?.status === "stopped");
    for (const r of stops) {
      const sort = r.trail.find((s) => s.id === "sort");
      if (sort?.status !== "passed") continue;
      expect(afterStopSummary(splitSampleNote(sort.summary).text)).not.toMatch(/^Checked for anything more urgent/);
    }
  });
});
