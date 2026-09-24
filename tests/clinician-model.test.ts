/**
 * The clinician screen's pure helpers: which support card a message gets and which lines it lists, the UK nation from
 * an address, when "Mark as a false alarm" is offered, and what a clear actually does to the patient's other replies.
 * Built from the same sources as the published data. Every patient and message is fictional.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import resultsData from "@/data/results.json";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";
import testsetData from "@/data/testset.json";
import evalData from "@/data/eval-report.json";
import baselineData from "@/data/baseline.json";
import helplinesData from "@/data/helplines.json";
import staffData from "@/data/staff.json";
import type { Baseline, EvalReport, Patient, PatientMessage, ResultsFile, TestLabel } from "@/lib/types";
import type { CaseFile, Helpline, QueueRow, StaffMember } from "@/lib/client/types";
import { buildPublicData } from "@/lib/client/public-data";
import { applySession, type DeskRow } from "@/lib/client/queue";
import { emptyData } from "@/lib/client/session-state";
import { LIVING_PATIENT_RULE_ID } from "@/lib/pipeline/death";
import {
  clearEffectText,
  clearToastDetail,
  deathFraming,
  falseAlarmFit,
  previewClear,
} from "@/components/clinician/model";
import { emergencyNumber, selectLines, supportMode, ukNation } from "@/components/clinician/support";

const HELPLINES = helplinesData as unknown as Helpline[];
const out = buildPublicData({
  results: resultsData as unknown as ResultsFile,
  messages: messagesData as unknown as PatientMessage[],
  patients: patientsData as unknown as Patient[],
  testset: testsetData as unknown as TestLabel[],
  evalReport: evalData as unknown as EvalReport,
  baseline: baselineData as unknown as Baseline,
  helplines: HELPLINES,
  staff: staffData as unknown as StaffMember[],
});
const items: QueueRow[] = out.queue.items;
const desk: DeskRow[] = applySession(items, emptyData());

function item(id: string): { row: DeskRow; data: CaseFile } {
  const row = desk.find((r) => r.messageId === id);
  const data = out.cases[id];
  if (!row || !data) throw new Error(`missing ${id}`);
  return { row, data };
}

function framing(id: string) {
  const { row, data } = item(id);
  return deathFraming(row, data.text, data.patient.firstName, data.result.rules.hits);
}

function mode(id: string) {
  const { row, data } = item(id);
  return supportMode(row, data.result, framing(id));
}

const numbers = (lines: Helpline[]) => lines.map((h) => h.number);

describe("support card matches the reason", () => {
  it("gives urgent medical help for a possible serious reaction or a swallowed product", () => {
    expect(mode("MSG-0176")).toBe("medical"); // lips swelling
    expect(mode("MSG-0137")).toBe("medical"); // a child drank oil
    expect(mode("MSG-0083")).toBe("medical"); // possible psychosis
    expect(mode("MSG-0047")).toBe("medical"); // overdose, emergency department
  });

  it("treats a living patient's overuse after a relative's death as urgent medical help, not a bereavement", () => {
    expect(mode("MSG-0172")).toBe("medical");
    const d = framing("MSG-0172");
    expect(d.livingPatient).toBe(true);
    expect(d.led).toBe(false);
    expect(d.aboutSomeoneElse).toBeTruthy();
  });

  it("gives crisis support for crisis language", () => {
    expect(mode("MSG-0144")).toBe("crisis");
    expect(mode("MSG-0098")).toBe("crisis");
    expect(mode("MSG-0133")).toBe("crisis");
  });

  it("gives a note for the family, not a crisis card, when the patient may have died", () => {
    for (const id of ["MSG-0156", "MSG-0124", "MSG-0143", "MSG-0179"]) {
      expect(framing(id).led).toBe(true);
      expect(mode(id)).toBe("family");
    }
  });

  it("gives a grief note, not a crisis card, when the patient signs a message about a relative's death", () => {
    // MSG-0120: "My dad passed away", signed by Mele. The rules read her as the living patient too (the same test,
    // lib/pipeline/death.ts), so her other replies are held clinician first, never withdrawn.
    const d = framing("MSG-0120");
    expect(d.aboutSomeoneElseBy).toBe("signed");
    expect(d.livingPatient).toBe(true);
    expect(d.led).toBe(false);
    expect(mode("MSG-0120")).toBe("grief");
  });

  it("gives a note for a grieving living patient when nothing else is urgent", () => {
    const { row, data } = item("MSG-0156");
    const text = "Hi,\n\nMy mum passed away last week, so I'd like to pause my plan for now.\n\nThanks,\nGrace";
    const d = deathFraming(row, text, "Grace", data.result.rules.hits);
    expect(d.aboutSomeoneElseBy).toBe("signed");
    expect(d.led).toBe(false);
    expect(supportMode(row, data.result, d)).toBe("grief");
  });

  it("falls back to the living-patient words when a message has no sign-off", () => {
    const { row, data } = item("MSG-0172");
    const text = data.text.replace(/\n+Charlotte Brown\s*$/, "");
    const d = deathFraming(row, text, "Charlotte", data.result.rules.hits);
    expect(d.aboutSomeoneElseBy).toBe("own_treatment");
    const living = data.result.rules.hits.find((h) => h.ruleId === LIVING_PATIENT_RULE_ID);
    expect(d.aboutSomeoneElse).toBe(living?.phrase);
  });
});

describe("support lines", () => {
  it("medical: emergency, then poisons, then health advice; the crisis line is folded away", () => {
    const { primary, other } = selectLines(HELPLINES, "AU", null, "medical");
    expect(primary.map((h) => h.kind)).toEqual(["emergency", "poisons", "health_advice"]);
    expect(numbers(primary)).toEqual(["000", "13 11 26", "1800 022 222"]);
    expect(other.map((h) => h.kind)).toEqual(["crisis"]);
    expect(selectLines(HELPLINES, "NZ", null, "medical").primary.map((h) => h.kind)).toEqual([
      "emergency",
      "poisons",
      "health_advice",
    ]);
  });

  it("crisis: emergency first, then the crisis line", () => {
    const { primary } = selectLines(HELPLINES, "AU", null, "crisis");
    expect(primary.map((h) => h.kind)).toEqual(["emergency", "crisis", "poisons", "health_advice"]);
  });

  it("family and grief lead with someone to talk to, not the emergency number", () => {
    for (const m of ["family", "grief"] as const) {
      const { primary } = selectLines(HELPLINES, "NZ", null, m);
      expect(primary[0].kind).toBe("crisis");
      expect(primary.some((h) => h.kind === "poisons")).toBe(false);
    }
  });

  it("shows only the patient's own UK nation's regional line", () => {
    const glasgow = selectLines(HELPLINES, "UK", "Scotland", "crisis");
    const shown = [...glasgow.primary, ...glasgow.other];
    expect(shown.map((h) => h.name)).toEqual(["Emergency services", "Samaritans", "NHS 24 (Scotland)"]);
    expect(shown.some((h) => h.region && h.region !== "Scotland")).toBe(false);

    const belfast = selectLines(HELPLINES, "UK", "Northern Ireland", "crisis");
    expect(belfast.primary.map((h) => h.name)).toEqual(["Emergency services", "Samaritans", "Lifeline (Northern Ireland)"]);

    const england = selectLines(HELPLINES, "UK", "England", "medical");
    expect(england.primary.map((h) => h.name)).toEqual(["Emergency services", "NHS 111 (England)"]);
    expect(england.other.map((h) => h.name)).toEqual(["Samaritans"]);
  });

  it("shows only the country-wide lines when no line serves the patient's region", () => {
    const unknown = selectLines(HELPLINES, "UK", null, "crisis");
    expect([...unknown.primary, ...unknown.other].every((h) => !h.region)).toBe(true);
    const ni = selectLines(HELPLINES, "UK", "Northern Ireland", "medical");
    expect(ni.primary.map((h) => h.name)).toEqual(["Emergency services"]);
  });

  it("uses only numbers from data/helplines.json", () => {
    const known = new Set(HELPLINES.map((h) => `${h.country}|${h.number}`));
    for (const country of ["AU", "NZ", "UK"] as const)
      for (const nation of [null, "England", "Scotland", "Wales", "Northern Ireland"])
        for (const m of ["crisis", "medical", "family", "grief"] as const) {
          const { primary, other } = selectLines(HELPLINES, country, nation, m);
          for (const h of [...primary, ...other]) expect(known.has(`${country}|${h.number}`)).toBe(true);
        }
    expect(emergencyNumber(HELPLINES, "AU")).toBe("000");
    expect(emergencyNumber(HELPLINES, "NZ")).toBe("111");
    expect(emergencyNumber(HELPLINES, "UK")).toBe("999");
  });
});

describe("UK nation from the address", () => {
  it("reads the nation from the region, then the town", () => {
    expect(ukNation({ country: "UK", region: "Glasgow City", suburb: "Shawlands, Glasgow" })).toBe("Scotland");
    expect(ukNation({ country: "UK", region: "Cardiff", suburb: "Canton, Cardiff" })).toBe("Wales");
    expect(ukNation({ country: "UK", region: "Belfast", suburb: "Ormeau" })).toBe("Northern Ireland");
    expect(ukNation({ country: "UK", region: "West Midlands", suburb: "Moseley, Birmingham" })).toBe("England");
    expect(ukNation({ country: "UK", region: "Greater Manchester", suburb: "Chorlton, Manchester" })).toBe("England");
    expect(ukNation({ country: "UK", region: "Bristol", suburb: "Clifton, Bristol" })).toBe("England");
    expect(ukNation({ country: "UK", region: "Isle of Wight", suburb: "Newport" })).toBe("England");
    expect(ukNation({ country: "UK", region: "Newport", suburb: "Caerleon" })).toBe("Wales");
    expect(ukNation({ country: "UK", region: "Isle of Anglesey", suburb: "Ynys Môn" })).toBe("Wales");
  });

  it("uses the postcode area when there is one", () => {
    expect(ukNation({ country: "UK", postcode: "G41 3YL" })).toBe("Scotland");
    expect(ukNation({ country: "UK", postcode: "BT7 1NN" })).toBe("Northern Ireland");
    expect(ukNation({ country: "UK", postcode: "CF5 1QE" })).toBe("Wales");
    expect(ukNation({ country: "UK", postcode: "SE15 4QN", region: "Greater London" })).toBe("England");
  });

  it("is null outside the UK or with no address", () => {
    expect(ukNation({ country: "AU", region: "Perth" })).toBeNull();
    expect(ukNation({ country: "UK" })).toBeNull();
  });

  it("puts every UK sample patient in a nation, Callum in Scotland", () => {
    expect(ukNation(item("MSG-0144").data.patient)).toBe("Scotland");
    for (const p of patientsData as unknown as Patient[])
      if (p.country === "UK") expect(ukNation({ country: p.country, region: p.address.region, suburb: p.address.suburb })).not.toBeNull();
  });
});

describe("Mark as a false alarm", () => {
  const fit = (id: string) => {
    const { row, data } = item(id);
    return falseAlarmFit(row, data.result);
  };

  it("is offered for a possible patient death, a figure of speech", () => {
    expect(fit("MSG-0156")?.kind).toBe("death");
    expect(fit("MSG-0120")?.kind).toBe("death");
    // "It's killing me" still stops at the rules, so the clear is offered as a figure of speech.
    expect(fit("MSG-0139")?.kind).toBe("figure");
    // The keen and impatient idioms no longer stop at all ("dying to get my order", MSG-0158; "this delay is killing me",
    // MSG-0167), so there is nothing to clear.
    expect(fit("MSG-0158")).toBeNull();
    expect(fit("MSG-0167")).toBeNull();
  });

  it("says what else still needs a clinician after a figure of speech", () => {
    expect(fit("MSG-0139")).toEqual({ kind: "figure", others: ["clinical_question"] });
  });

  it("is not offered for a living patient's overuse, a serious reaction or crisis language", () => {
    for (const id of ["MSG-0172", "MSG-0176", "MSG-0137", "MSG-0047", "MSG-0144", "MSG-0098"]) expect(fit(id)).toBeNull();
  });

  it("is not offered for an agent escalation or a message with no hold", () => {
    const { row, data } = item("MSG-0156");
    expect(falseAlarmFit({ ...row, escalatedByAgent: true }, data.result)).toBeNull();
    const q = item("MSG-0009");
    expect(falseAlarmFit(q.row, q.data.result)).toBeNull();
  });
});

describe("what a clear actually does", () => {
  it("releases the replies a possible death withdrew", () => {
    const { row } = item("MSG-0156");
    const before = desk.filter((r) => r.lock?.messageId === row.messageId);
    expect(before.length).toBeGreaterThan(0);
    const p = previewClear(items, emptyData(), "MSG-0156");
    expect(p).toMatchObject({ locked: before.length, released: before.length, heldByThis: 0, keepsAlert: false });
    expect(clearEffectText(p, "Grace")).toBe(`It releases the ${before.length} replies it holds back on the desk.`);
    expect(clearToastDetail(p)).toBe(`${before.length} replies released on the desk.`);
  });

  it("says the replies stay held when the clear keeps another alert", () => {
    // A possible death that also reports a side effect: the clear lifts the withdrawal, the rest still needs contact.
    const mixed = items.map((r) =>
      r.messageId === "MSG-0156" ? { ...r, seed: { ...r.seed, safety: ["bereavement", "side_effect"] as QueueRow["seed"]["safety"] } } : r,
    );
    const n = desk.filter((r) => r.lock?.messageId === "MSG-0156").length;
    const p = previewClear(mixed, emptyData(), "MSG-0156");
    expect(p).toMatchObject({ locked: n, released: 0, heldByThis: n, wasWithdrawal: true, keepsAlert: true });
    const text = clearEffectText(p, "Grace");
    expect(text).toContain("It lifts the bereavement withdrawal.");
    expect(text).toContain(`${n} replies stay held until you have been in touch with Grace.`);
    expect(text).not.toMatch(/releases/);
    expect(clearToastDetail(p)).toBe(`${n} replies now wait until you have been in touch.`);
  });

  it("matches what the desk shows after the clear", () => {
    for (const id of ["MSG-0156", "MSG-0158", "MSG-0120"]) {
      const p = previewClear(items, emptyData(), id);
      const data = emptyData();
      data.clinician[id] = { calls: [], replies: [], notes: [], cleared: { at: "2026-09-24T00:00:00Z", by: "x", note: "n" } };
      const after = applySession(items, data);
      const wasLocked = desk.filter((r) => r.lock?.messageId === id).map((r) => r.messageId);
      const free = after.filter((r) => wasLocked.includes(r.messageId) && !r.lock).length;
      expect(p.released).toBe(free);
    }
  });

  it("says so when the message holds nothing back", () => {
    const p = previewClear(items, emptyData(), "MSG-0009");
    expect(p.locked).toBe(0);
    expect(clearEffectText(p, "Ava")).toBe("It holds back no replies to Ava on the desk.");
    expect(clearToastDetail(p)).toBeUndefined();
  });
});

describe("clinician screen copy", () => {
  it("uses no em or en dashes", () => {
    const dir = path.join(__dirname, "..", "components", "clinician");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(/[\u2013\u2014]/.test(src), f).toBe(false);
    }
  });
});
