import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EvalCase, Route } from "@/lib/types";
import { ROUTINE_SAMPLE_NOTE, routineQueueNote } from "@/components/tests/Accuracy";
import { TOUR_STEP_COUNT, TOUR_STOPS } from "@/components/tour/steps";
import { pickSpan } from "@/components/tour/anchor";
import { SAMPLE_STAND_IN } from "@/components/ui/SampleNotice";
import { splitSampleNote } from "@/components/trail/outcome";
import { headline, TEAM_REPLY_LABEL, threadOpensByDefault, threadSummary } from "@/components/tests/model";
import type { PublicEvalReport, PublicMeta } from "@/lib/client/types";
import { SAMPLE_RUN_NOTE } from "@/lib/pipeline/run";
import { AGENT_DEATH_RULE_ID } from "@/lib/pipeline/death";
import { RULE_LABELS, ruleLabel, ruleTooltip } from "@/lib/rule-labels";

const SAFETY = new Set(["crisis", "bereavement", "adverse_event", "side_effect", "clinical_question"]);
const isSafetyCategory = (c: EvalCase) => SAFETY.has(c.expected.expectedCategory);

let n = 0;
function evalCase(category: string, expected: Route, got: Route): EvalCase {
  n += 1;
  const messageId = `MSG-${String(n).padStart(4, "0")}`;
  return {
    messageId,
    expected: {
      messageId,
      expectedCategory: category as EvalCase["expected"]["expectedCategory"],
      expectedRoute: expected,
      mustHold: false,
      tricky: false,
    } as EvalCase["expected"],
    got: { route: got, holdOrders: false },
    routeCorrect: expected === got,
    categoryCorrect: true,
    safetyMiss: false,
    falseEscalation: false,
  };
}

describe("routineQueueNote (Test results, Sorting by type)", () => {
  it("says nothing when every routine message was in its expected queue", () => {
    expect(routineQueueNote([evalCase("billing", "draft", "draft")], isSafetyCategory)).toBeNull();
  });

  it("ignores safety types, which have their own note", () => {
    expect(routineQueueNote([evalCase("crisis", "clinician", "urgent")], isSafetyCategory)).toBeNull();
  });

  it("says every miss was on the safe side only when that is true", () => {
    const note = routineQueueNote(
      [evalCase("billing", "draft", "person"), evalCase("order_status", "person", "urgent"), evalCase("billing", "draft", "draft")],
      isSafetyCategory,
    );
    expect(note).toBe(
      "All 2 routine messages outside their expected queue went to more human care than they needed, for example a person wrote a reply the AI could have drafted.",
    );
  });

  it("names a message that got less care instead of folding it into the safe side", () => {
    const note = routineQueueNote(
      [evalCase("billing", "draft", "person"), evalCase("billing", "draft", "person"), evalCase("complaint", "person", "draft")],
      isSafetyCategory,
    );
    expect(note).toContain("2 of the 3 routine messages outside their expected queue went to more human care");
    expect(note).toContain("The other one got an AI draft where the label expected a person to write the reply.");
    expect(note).toContain("A person still reads every draft before it is sent.");
    expect(note).not.toMatch(/^All /);
  });

  it("never claims more care for a single message that got less", () => {
    const note = routineQueueNote([evalCase("complaint", "person", "draft")], isSafetyCategory);
    expect(note).toBe(
      "The one routine message outside its expected queue got an AI draft where the label expected a person to write the reply. A person still reads every draft before it is sent.",
    );
  });

  it("uses general words when a lower-care miss was not an AI draft", () => {
    const note = routineQueueNote([evalCase("billing", "clinician", "person")], isSafetyCategory);
    expect(note).toBe("The one routine message outside its expected queue got less human care than the label expected.");
  });

  it("the sample caveat never implies real-world performance", () => {
    expect(ROUTINE_SAMPLE_NOTE).toMatch(/built-in stand-in, not Claude/);
    expect(ROUTINE_SAMPLE_NOTE).toMatch(/nothing about real-world performance/);
  });
});

describe("tour: short and easy to follow", () => {
  const numbered = TOUR_STOPS.filter((s) => !s.end);
  const words = (t: string) => t.trim().split(/\s+/).length;

  it("has five numbered stops, one per step, then the closing card", () => {
    expect(TOUR_STEP_COUNT).toBe(5);
    expect(numbered.map((s) => s.step)).toEqual([1, 2, 3, 4, 5]);
    expect(TOUR_STOPS[TOUR_STOPS.length - 1].end).toBe(true);
  });

  it("keeps every card to a short title and at most two sentences", () => {
    const ctx = {
      routine: { firstName: "Priya", category: "order_status" as const },
      safety: { firstName: "Zara", holdOrders: true, reason: { phrase: "lips are swelling up" } as never },
    };
    for (const s of numbered) {
      expect(words(s.title(ctx))).toBeLessThanOrEqual(7);
      const body = s.body(ctx);
      expect(words(body)).toBeLessThanOrEqual(32);
      expect(body.split(/[.!?](\s|$)/).filter((x) => x && x.trim().length > 1).length).toBeLessThanOrEqual(3);
    }
  });

  it("points the desk stops at the reply, the check trail and the stopped message", () => {
    expect(TOUR_STOPS.find((s) => s.id === "draft")?.anchor).toBe("desk-reply");
    // ReplyPanel lays the seven steps out while the "checks" stop is up.
    expect(TOUR_STOPS.find((s) => s.id === "checks")?.anchor).toBe("desk-trail");
    const stop = TOUR_STOPS.find((s) => s.id === "stop");
    expect(stop?.anchor).toBe("desk-conversation");
    expect(stop?.message).toBe("safety");
  });

  it("ends in the builder's own voice", () => {
    const end = TOUR_STOPS.find((s) => s.end);
    expect(end?.body({})).toMatch(/^I'm Chanon Poovaviranon \(Beam\)\. I designed and built/);
  });
});

describe("tour: pickSpan (a phone stop that lights a span)", () => {
  it("pickSpan keeps the whole list when it fits, and falls back to the first source when it does not", () => {
    // Marker line at 100; list ends at 400, first source at 300, its heading at 200.
    expect(pickSpan(100, [400, 300, 200], 400)?.bottom).toBe(400);
    expect(pickSpan(100, [400, 300, 200], 260)?.bottom).toBe(300);
    expect(pickSpan(100, [400, 300, 200], 150)?.bottom).toBe(200);
    expect(pickSpan(100, [400, 300, 200], 50)?.bottom).toBe(200);
    expect(pickSpan(100, [], 400)).toBeNull();
  });

  it("pickSpan starts at the paragraph when it fits, and at the marker's line when it does not", () => {
    // Paragraph starts at 20, marker line at 100, first source heading ends at 200.
    expect(pickSpan([20, 100], [200], 220)?.top).toBe(16);
    expect(pickSpan([20, 100], [200], 150)?.top).toBe(96);
    // A paragraph with the whole list beats the marker line with the whole list.
    expect(pickSpan([20, 100], [400, 200], 420)).toEqual({ top: 16, bottom: 400 });
  });
});

describe("plain copy", () => {
  const root = path.resolve(__dirname, "..");
  const read = (f: string) => readFileSync(path.join(root, f), "utf8");
  const files = [
    "scripts/eval.ts",
    "components/tests/Accuracy.tsx",
    "components/tour/steps.ts",
    "components/how/FailureTable.tsx",
    "components/how/HowItWorks.tsx",
    "docs/AGENT-GUIDE.md",
    "docs/RUNBOOK.md",
    "docs/VIDEO-SCRIPT.md",
  ];

  it.each(files)("%s has no em or en dashes", (f) => {
    expect(read(f)).not.toMatch(new RegExp("[\\u2013\\u2014]"));
  });

  it.each(["components/how/FailureTable.tsx", "components/how/HowItWorks.tsx", "docs/AGENT-GUIDE.md", "docs/RUNBOOK.md", "docs/VIDEO-SCRIPT.md"])(
    "%s names only the desk's current filters",
    (f) => {
      expect(read(f)).not.toMatch(/needs a person/i);
    },
  );

  it("the Test results change log is written for a non-technical reader", () => {
    const src = read("scripts/eval.ts");
    const log =
      src.slice(src.indexOf("const CHANGELOG"), src.indexOf("/** Currency markers")) +
      src.slice(src.indexOf("const measuredCore"), src.indexOf("const measured ="));
    for (const jargon of [/strict JSON/i, /\bThe eval\b/, /\bby id\b/, /names by number/, /mock sorter/, /false escalations/]) {
      expect(log).not.toMatch(jargon);
    }
    // A sample run names the stand-in in the same plain words as the "Sample results" chip.
    expect(log).toContain(SAMPLE_STAND_IN);
    expect(log).not.toMatch(/offline stand-in/);
  });

  it("the pipeline's sample note names the stand-in the way the UI does", () => {
    expect(SAMPLE_RUN_NOTE).toBe(`Sample run: ${SAMPLE_STAND_IN}.`);
    expect(SAMPLE_RUN_NOTE).not.toMatch(/offline/);
  });

  it("the trail hides the sample note, and no generated data still carries its older wording", () => {
    expect(splitSampleNote(`Order status, confidence 0.92. ${SAMPLE_RUN_NOTE}`)).toEqual({ text: "Order status, confidence 0.92.", sample: true });
    const legacy = /offline stand-in/i;
    for (const file of ["data/results.json", "data/eval-report.json", "public/data/queue.json", "public/data/eval-report.json"]) {
      expect(read(file), file).not.toMatch(legacy);
    }
    const cases = path.join(root, "public/data/cases");
    for (const name of readdirSync(cases)) {
      expect(readFileSync(path.join(cases, name), "utf8"), name).not.toMatch(legacy);
    }
  });

  it("the newest change log entry says what changed for patients and agents, not how the screens were built", () => {
    const src = read("scripts/eval.ts");
    const start = src.indexOf("version: `${RULES_VERSION} + ${PROMPTS_VERSION}`");
    const entry = src.slice(start, src.indexOf("];", start));
    expect(start).toBeGreaterThan(0);
    for (const jargon of [/toasts?\b/i, /sticky/i, /keyboard focus/i, /shortcut/i, /\bRewrote\b/, /change log/i, /Rules v2:/, /Accessibility:/, /live region/i]) {
      expect(entry).not.toMatch(jargon);
    }
    // Short enough to read at a glance: no more than six sentences.
    const text = [...entry.slice(entry.indexOf("change:")).matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
    expect(text.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length).toBeLessThanOrEqual(6);
  });
});

describe("rule labels (the trail's rule tooltip)", () => {
  const root = path.resolve(__dirname, "..");
  const read = (f: string) => readFileSync(path.join(root, f), "utf8");
  const pipeline = ["lib/pipeline/rules.ts", "lib/pipeline/death.ts"].map(read).join("\n");

  // The rule ids added in the red-team rounds, each with a plain label.
  const NEW_IDS = [
    "crisis.stockpile",
    "crisis.plan_signal",
    "crisis.be_with_them",
    "crisis.helpline",
    "crisis.worthless",
    "crisis.weapon_on_self",
    "crisis.for_when",
    "crisis.skip_to_save",
    "crisis.last_message",
    "crisis.say_goodbye",
    "crisis.means_and_end",
    "bereavement.idiom",
    "bereavement.own_life",
    "bereavement.rites",
    "adverse.disoriented",
    "adverse.poisons_line",
    "adverse.early_run_out",
    "adverse.prescribed_overuse",
    "adverse.finished_early",
    "adverse.high_temperature",
    "adverse.fall_injury",
    "adverse.road_accident",
    "adverse.too_often",
    "adverse.others_medicine",
    "adverse.serious_signs",
    "side_effect.tingling",
    "side_effect.swelling_limbs",
    "clinical.dose_change",
    "clinical.max_amount",
    "clinical.claimed_authority",
    "clinical.is_normal",
    "clinical.route",
    "clinical.pet_use",
  ];

  it.each(NEW_IDS)("%s has a plain label", (id) => {
    expect(ruleLabel(id)).toBeTruthy();
  });

  it("uses the suggested wording for the whole-message checks", () => {
    expect(ruleLabel("adverse.early_run_out")).toBe("Supply used up far too early");
    expect(ruleLabel("adverse.prescribed_overuse")).toBe("More than the prescribed amount");
    expect(ruleLabel("adverse.finished_early")).toBe("Supply finished within days");
    expect(ruleLabel("adverse.high_temperature")).toBe("High temperature");
    expect(ruleLabel("bereavement.own_life")).toBe("Reported they took their own life");
    expect(ruleLabel("clinical.pet_use")).toBe("Using it on a pet");
  });

  it.each(Object.keys(RULE_LABELS))("%s is a real rule id", (id) => {
    // A label for an id the rules never produce would never show, and usually means a typo.
    expect(id === AGENT_DEATH_RULE_ID || pipeline.includes(`"${id}"`)).toBe(true);
  });

  it.each(Object.entries(RULE_LABELS))("%s reads as plain words", (_id, label) => {
    expect(label).not.toMatch(new RegExp("[\u2013\u2014]"));
    expect(label).not.toMatch(/[._]/);
    expect(label[0]).toBe(label[0].toUpperCase());
    expect(label.length).toBeLessThanOrEqual(60);
  });

  it("reads an earlier-message hit as the same rule", () => {
    expect(ruleLabel("thread.crisis.stockpile")).toBe(ruleLabel("crisis.stockpile"));
    expect(ruleLabel(AGENT_DEATH_RULE_ID)).toMatch(/earlier reply by the team/);
  });

  it("puts the plain words before the rule ids, and keeps the ids alone when the chip already says it all", () => {
    expect(ruleTooltip(["crisis.stockpile", "crisis.plan_signal"])).toBe(
      "Keeping doses back; Words that point to a plan. Rules crisis.stockpile, crisis.plan_signal",
    );
    expect(ruleTooltip(["crisis.suicide"])).toBe("Rule crisis.suicide");
    expect(ruleTooltip(["crisis.suicide", "crisis.suicide"])).toBe("Rule crisis.suicide");
  });

  it("no page copy hard-codes a count of rules", () => {
    for (const f of ["components/how/HowItWorks.tsx", "components/how/FailureTable.tsx", "components/how/diagrams.tsx", "docs/AGENT-GUIDE.md", "docs/RUNBOOK.md"]) {
      expect(read(f)).not.toMatch(/\b\d+ (?:safety |crisis |plain )?(?:rules|patterns)\b/i);
    }
  });
});

describe("Test results page: surprise (red team) cases", () => {
  const root = path.resolve(__dirname, "..");
  const read = (f: string) => readFileSync(path.join(root, f), "utf8");
  const json = <T,>(f: string) => JSON.parse(read(f)) as T;
  const report = json<PublicEvalReport>("public/data/eval-report.json");
  const meta = json<PublicMeta>("public/data/meta.json");
  const testsFiles = ["Accuracy.tsx", "CaseDetail.tsx", "CaseTable.tsx", "Headline.tsx", "HowTested.tsx", "TestsScreen.tsx", "TrickyCases.tsx", "model.ts"].map(
    (f) => `components/tests/${f}`,
  );

  it("the headline's red team count is the live test-only count", () => {
    expect(headline(report).redTeamCases).toBe(meta.counts.testOnly);
  });

  it("every id from MSG-0901 up, four-digit thousands included, is marked test-only", () => {
    for (const c of report.cases) {
      const n = Number(c.messageId.slice(4));
      expect(report.caseMeta[c.messageId]?.testOnly ?? false).toBe(n >= 901);
    }
  });

  it.each(testsFiles)("%s never hard-codes a red team count or matches cases by an id prefix", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/\b(?:22|32|96|106|128)\b(?!\s*(?:px|%|\]))/);
    expect(src).not.toMatch(/MSG-09["'`]|startsWith\(["'`]MSG-/);
  });

  it.each(testsFiles)("%s shows dates, never a time relative to the demo's now", (f) => {
    // Many surprise messages are dated after the demo's "now", so "in 5 days" or a negative wait would read oddly.
    expect(read(f)).not.toMatch(/\b(?:relativeTime|waitingTime|minutesSince)\b/);
  });

  it("a case with a reply from the team opens its conversation, and says whose words are whose", () => {
    const team = [{ from: "agent" as const }];
    expect(threadOpensByDefault(team, false)).toBe(true);
    expect(threadOpensByDefault([{ from: "patient" as const }], true)).toBe(true);
    expect(threadOpensByDefault([{ from: "patient" as const }], false)).toBe(false);
    expect(threadOpensByDefault([], true)).toBe(false);
    expect(threadSummary(team)).toBe("1 earlier reply from the team in this conversation");
    expect(threadSummary([{ from: "patient" }, { from: "agent" }])).toBe("2 earlier messages in this conversation, including 1 reply from the team");
    expect(threadSummary([{ from: "patient" }])).toBe("1 earlier message in this conversation");
    expect(TEAM_REPLY_LABEL).toBe("Reply from the team");
  });

  it("every surprise case with a thread publishes it for the case view", () => {
    const withThread = Object.keys(report.caseMeta).filter((id) => {
      if (!report.caseMeta[id]?.testOnly) return false;
      const file = json<{ thread?: unknown[] }>(`public/data/cases/${id}.json`);
      return (file.thread?.length ?? 0) > 0;
    });
    expect(withThread.length).toBeGreaterThan(0);
    const msg0995 = json<{ thread: { from: string }[] }>("public/data/cases/MSG-0995.json");
    expect(msg0995.thread.some((t) => t.from === "agent")).toBe(true);
  });
});
