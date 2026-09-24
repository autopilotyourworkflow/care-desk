/**
 * Whose words and whose death: the clinician reason card's death wording (components/clinician/model.ts) and the
 * trail's lookup of a hit from an earlier reply by the team (components/trail/evidence.tsx). Built from the same sources
 * as the published data. Every patient and message is fictional.
 */
import { describe, expect, it } from "vitest";
import resultsData from "@/data/results.json";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";
import testsetData from "@/data/testset.json";
import evalData from "@/data/eval-report.json";
import baselineData from "@/data/baseline.json";
import helplinesData from "@/data/helplines.json";
import staffData from "@/data/staff.json";
import type { Baseline, EvalReport, Patient, PatientMessage, ResultsFile, RuleHit, TestLabel } from "@/lib/types";
import type { Helpline, StaffMember } from "@/lib/client/types";
import { buildPublicData } from "@/lib/client/public-data";
import { applySession } from "@/lib/client/queue";
import { emptyData } from "@/lib/client/session-state";
import { AGENT_DEATH_RULE_ID } from "@/lib/pipeline/death";
import { shortPhrase } from "@/lib/format";
import { deathFraming, distinctHits, reasonHeadline } from "@/components/clinician/model";
import { earlierSource, isTeamHit, matchesLabel } from "@/components/trail/evidence";

const out = buildPublicData({
  results: resultsData as unknown as ResultsFile,
  messages: messagesData as unknown as PatientMessage[],
  patients: patientsData as unknown as Patient[],
  testset: testsetData as unknown as TestLabel[],
  evalReport: evalData as unknown as EvalReport,
  baseline: baselineData as unknown as Baseline,
  helplines: helplinesData as unknown as Helpline[],
  staff: staffData as unknown as StaffMember[],
});
const desk = applySession(out.queue.items, emptyData());
const results = (resultsData as unknown as ResultsFile).results;
const messages = messagesData as unknown as PatientMessage[];

function item(id: string) {
  const row = desk.find((r) => r.messageId === id);
  const data = out.cases[id];
  if (!row || !data) throw new Error(`missing ${id}`);
  return { row, data };
}

describe("reason card: whose death, and whether the patient is using their treatment", () => {
  it("a relative's death signed by the patient says nothing about their treatment (MSG-0120)", () => {
    const { row, data } = item("MSG-0120");
    const d = deathFraming(row, data.text, data.patient.firstName, data.result.rules.hits);
    expect(d.aboutSomeoneElseBy).toBe("signed");
    expect(d.livingPatient).toBe(true);
    expect(d.usingOwnTreatment).toBe(false);
  });

  it("a relative's tangi signed by the patient reads the same way (MSG-0945)", () => {
    const { row } = item("MSG-0120");
    const r = results.find((x) => x.messageId === "MSG-0945");
    const m = messages.find((x) => x.id === "MSG-0945");
    const p = (patientsData as unknown as Patient[]).find((x) => x.id === m?.patientId);
    expect(r && m && p).toBeTruthy();
    const text = [m!.subject, m!.body].filter(Boolean).join("\n\n");
    const d = deathFraming(row, text, p!.firstName, r!.rules.hits);
    expect(d.livingPatient).toBe(true);
    expect(d.usingOwnTreatment).toBe(false);
  });

  it("an adverse.living_patient hit is what says they are using their own treatment (MSG-0172)", () => {
    const { row, data } = item("MSG-0172");
    const d = deathFraming(row, data.text, data.patient.firstName, data.result.rules.hits);
    expect(d.livingPatient).toBe(true);
    expect(d.usingOwnTreatment).toBe(true);
  });

  it("the headline never says the rules cannot tell whose death it is when they did", () => {
    for (const id of ["MSG-0120", "MSG-0172"]) {
      const { row, data } = item(id);
      const first = data.patient.firstName;
      const headline = reasonHeadline(row, deathFraming(row, data.text, first, data.result.rules.hits), first);
      expect(headline, id).not.toMatch(/cannot tell/);
      expect(headline, id).toContain(`${first} writing about someone close to them`);
    }
    const { row, data } = item("MSG-0120");
    const first = data.patient.firstName;
    expect(reasonHeadline(row, deathFraming(row, data.text, first, data.result.rules.hits), first)).toMatch(
      /The rules stop every mention of a death on purpose, so orders went on hold and a clinician makes contact\.$/,
    );
  });
});

describe("a hit from an earlier reply by the team is never shown as the patient's words", () => {
  const team: RuleHit = { ruleId: AGENT_DEATH_RULE_ID, category: "bereavement", phrase: "sorry for your loss", start: -1, end: -1 };
  const patient: RuleHit = { ruleId: "thread.bereavement.passed_away", category: "bereavement", phrase: "passed away", start: -1, end: -1 };
  const thread = [
    { from: "patient" as const, body: "Hi, I'm so sorry for your loss too, and Mum passed away in June." },
    { from: "agent" as const, body: "I'm so sorry for your loss. We are closing her account today." },
  ];

  it("looks a team hit up in the team's replies, and a patient hit in the patient's messages", () => {
    expect(isTeamHit(team)).toBe(true);
    expect(isTeamHit(patient)).toBe(false);
    expect(earlierSource(team, thread)).toBe(thread[1].body);
    expect(earlierSource(patient, thread)).toBe(thread[0].body);
    expect(earlierSource(team, thread.filter((e) => e.from === "patient"))).toBeUndefined();
  });

  it("labels whose words the matches are", () => {
    expect(matchesLabel([team])).toBe("1 match in an earlier reply by the team");
    expect(matchesLabel([patient])).toBe("1 match in the patient's own words");
    expect(matchesLabel([patient, team])).toBe("1 match in the patient's own words, 1 match in an earlier reply by the team");
  });

  it("the reason card keeps team words apart from the patient's", () => {
    const words = distinctHits([team, patient]);
    expect(words.find((w) => w.phrase === team.phrase)?.team).toBe(true);
    expect(words.find((w) => w.phrase === patient.phrase)?.team).toBe(false);
  });

  it("the real team-reply case finds its source in the agent entry (MSG-0995)", () => {
    const r = results.find((x) => x.messageId === "MSG-0995");
    const m = messages.find((x) => x.id === "MSG-0995");
    const hit = r?.rules.hits.find(isTeamHit);
    expect(hit).toBeDefined();
    const body = earlierSource(hit!, m?.thread);
    expect(body).toBeDefined();
    expect(m?.thread?.find((e) => e.body === body)?.from).toBe("agent");
  });
});

describe("long matches from whole-message checks", () => {
  it("are shortened at a word for lists, with nothing lost when short", () => {
    expect(shortPhrase("tangi for my uncle")).toBe("tangi for my uncle");
    const long = "I've got a bottle of pills and a bottle of vodka here and honestly I think I'm done with all of it";
    const s = shortPhrase(long);
    expect(s.length).toBeLessThanOrEqual(61);
    expect(s.endsWith("…")).toBe(true);
    expect(long.startsWith(s.slice(0, -1))).toBe(true);
  });
});
