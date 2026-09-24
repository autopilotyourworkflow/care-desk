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
import { buildQueue, compareQueueItems, alertsFor } from "@/lib/fixtures/queue";
import { isDemoMode } from "@/lib/pipeline/run";
import { buildPublicData, isTestOnly, previewOf } from "@/lib/client/public-data";
import { applySession, canSendReply, clearKeepsAlert, clinicianRows, deriveQueue, openDeskRows, replyPermission } from "@/lib/client/queue";
import { CALL_NO_ANSWER, CALL_SPOKE, emptyData, initialState, sessionReducer, type SessionAction } from "@/lib/client/session-state";
import { resolveWelcomeIds } from "@/components/tour/steps";
import type { Helpline, StaffMember } from "@/lib/client/types";

const RESULTS = resultsData as unknown as ResultsFile;
const MESSAGES = messagesData as unknown as PatientMessage[];
const out = buildPublicData({
  results: RESULTS,
  messages: MESSAGES,
  patients: patientsData as unknown as Patient[],
  testset: testsetData as unknown as TestLabel[],
  evalReport: evalData as unknown as EvalReport,
  baseline: baselineData as unknown as Baseline,
  helplines: helplinesData as unknown as Helpline[],
  staff: staffData as unknown as StaffMember[],
});
const rows = out.queue.items;

const deskResults = RESULTS.results.filter((r) => !isTestOnly(r.messageId));
const deskMessages = MESSAGES.filter((m) => !isTestOnly(m.id));
const msgById = new Map(MESSAGES.map((m) => [m.id, m]));

/**
 * buildQueue on the full results with these false alarms cleared. A clear takes out the bereavement reading; a message
 * that also carries another safety reading keeps it (clearKeepsAlert), which here means its bereavement hits go.
 */
function expected(cleared: string[]) {
  const keeps = new Set(cleared.filter((id) => clearKeepsAlert(rows.find((r) => r.messageId === id)!)));
  const results = deskResults.map((r) => {
    if (!keeps.has(r.messageId)) return r;
    const hits = r.rules.hits.filter((h) => h.category !== "bereavement");
    const sort = r.sort?.category === "bereavement" ? undefined : r.sort;
    return { ...r, rules: { ...r.rules, hits, matched: hits.length > 0 }, sort };
  });
  const full = cleared.filter((id) => !keeps.has(id));
  return buildQueue(results, deskMessages, { cleared: full }).sort(compareQueueItems);
}

const pick = (r: { status: string; sendable: boolean; lock?: unknown; patientAlerts: unknown }) => ({
  status: r.status,
  sendable: r.sendable,
  lock: r.lock,
  patientAlerts: r.patientAlerts,
});

describe("public queue.json", () => {
  it("holds every desk message and none of the red-team slice", () => {
    expect(rows).toHaveLength(deskResults.length);
    expect(rows.some((r) => isTestOnly(r.messageId))).toBe(false);
    expect(out.meta.counts).toEqual({ queue: rows.length, cases: RESULTS.results.length, testOnly: RESULTS.results.length - deskResults.length });
  });

  it("matches buildQueue on the full results, in display order", () => {
    const full = expected([]);
    expect(rows.map((r) => r.messageId)).toEqual(full.map((q) => q.messageId));
    rows.forEach((r, i) => expect(pick(r)).toEqual(pick(full[i])));
  });

  it("re-derives the same locks as buildQueue when any alert is cleared", () => {
    const raisers = deskResults.filter((r) => alertsFor(r, msgById.get(r.messageId)!).length).map((r) => r.messageId);
    expect(raisers.length).toBeGreaterThan(5);
    const sets = [...raisers.map((id) => [id]), raisers, raisers.slice(0, Math.ceil(raisers.length / 2))];
    for (const cleared of sets) {
      const full = new Map(expected(cleared).map((q) => [q.messageId, q]));
      const derived = deriveQueue(rows, cleared);
      for (const r of derived) expect(pick(r), `${r.messageId} with ${cleared.join(",")} cleared`).toEqual(pick(full.get(r.messageId)!));
    }
  });

  it("with nothing cleared, returns the same rows", () => {
    expect(deriveQueue(rows, [])).toBe(rows);
  });

  it("never offers Send for a withdrawn or check-first row", () => {
    for (const r of rows) {
      if (r.status === "withdrawn" || r.status === "check_first") {
        expect(r.sendable).toBe(false);
        expect(r.lock).toBeDefined();
        expect(replyPermission(r)).toBe("blocked");
      }
      if (r.status === "ready") expect(replyPermission(r)).toBe("send_draft");
    }
  });

  it("row previews are one line and short", () => {
    for (const r of rows) {
      expect(r.preview).not.toMatch(/\n/);
      expect(r.preview.length).toBeLessThanOrEqual(141);
    }
    expect(previewOf("short one")).toBe("short one");
    expect(previewOf("word ".repeat(60))).toMatch(/word…$/);
  });
});

describe("public case files", () => {
  it("carry the full result, the text rule hits index into, and the row", () => {
    for (const r of RESULTS.results) {
      const c = out.cases[r.messageId];
      expect(c.result).toEqual(r);
      const m = msgById.get(r.messageId)!;
      expect(c.text).toBe(m.subject ? `${m.subject}\n\n${m.body}` : m.body);
      for (const h of r.rules.hits) if (h.start >= 0) expect(c.text.slice(h.start, h.end).toLowerCase()).toBe(h.phrase.toLowerCase());
      expect(c.testOnly).toBe(isTestOnly(r.messageId));
      expect(Boolean(c.row)).toBe(!c.testOnly);
      expect(JSON.stringify(c.patient)).not.toMatch(/"dob"|"identifiers"|"authorNote"/);
    }
  });

  it("desk cases list only desk siblings", () => {
    for (const c of Object.values(out.cases)) if (!c.testOnly) expect(c.siblings.every((s) => !s.testOnly)).toBe(true);
  });

  it("personas are the three demo patients, without author notes, with citable sources", () => {
    expect(out.personas.personas.map((p) => p.patient.id)).toEqual(["PT-1001", "PT-1031", "PT-1043"]);
    for (const p of out.personas.personas) {
      expect("authorNote" in p.patient).toBe(false);
      expect(p.sources[0].id).toBe("PLAN");
      expect(p.sources.length).toBeGreaterThan(1);
    }
  });

  it("meta flags mock results", () => {
    const mock = RESULTS.models.sort === "mock" || RESULTS.models.draft === "mock" || RESULTS.results.some(isDemoMode);
    expect(out.meta.isMock).toBe(mock);
    expect(out.meta.generatedAt).toBe(RESULTS.generatedAt);
  });

  it("meta carries what the welcome page needs, so it can skip queue.json and eval-report.json", () => {
    expect(out.meta.welcome).toMatchObject(resolveWelcomeIds(rows));
    const t = out.evalReport.totals;
    expect(out.meta.welcome.totals).toEqual({
      cases: t.cases,
      safetyCases: t.safetyCases,
      safetyCaught: t.safetyCaught,
      holdsExpected: t.holdsExpected,
      holdsPlaced: t.holdsPlaced,
    });
    for (const id of [out.meta.welcome.routine, out.meta.welcome.clinical]) expect(out.cases[id]).toBeDefined();
  });
});

describe("applySession", () => {
  const AT = "2026-09-23T11:00:00.000Z";
  const ready = rows.find((r) => r.status === "ready")!;
  const person = rows.find((r) => r.status === "needs_person" && !r.lock)!;
  const urgent = rows.find((r) => r.status === "urgent" && r.holdOrders)!;

  it("marks sent rows replied and escalated rows for the clinician queue", () => {
    const s = [
      { type: "send", messageId: ready.messageId, at: AT, by: "ST-01", text: "Hi" },
      { type: "escalate", messageId: person.messageId, at: AT, by: "ST-01" },
    ] as const;
    const data = s.reduce(sessionReducer, initialState()).data;
    const desk = applySession(rows, data);
    const sent = desk.find((r) => r.messageId === ready.messageId)!;
    expect(sent).toMatchObject({ replied: true, inClinicianQueue: false });
    expect(replyPermission(sent)).toBe("blocked");
    const esc = desk.find((r) => r.messageId === person.messageId)!;
    expect(esc).toMatchObject({ escalatedByAgent: true, inClinicianQueue: true, replied: false });
    const open = openDeskRows(desk).map((r) => r.messageId);
    expect(open).not.toContain(ready.messageId);
    expect(open).not.toContain(person.messageId);
    const clin = clinicianRows(desk);
    expect(clin.map((r) => r.messageId)).toContain(person.messageId);
    expect(clin[0].status).toBe("urgent");
    expect(clin.every((r) => r.inClinicianQueue)).toBe(true);
  });

  it("tracks the hold until a clinician resumes it", () => {
    expect(applySession(rows, emptyData()).find((r) => r.messageId === urgent.messageId)!.holdActive).toBe(true);
    const data = sessionReducer(initialState(), {
      type: "resumeHold",
      messageId: urgent.messageId,
      at: AT,
      by: "ST-07",
      note: "Spoke to the patient",
    }).data;
    expect(applySession(rows, data).find((r) => r.messageId === urgent.messageId)!.holdActive).toBe(false);
  });

  it("clearing an alert releases the patient's other drafts", () => {
    const locked = rows.find((r) => r.status === "check_first" && r.patientAlerts.length === 1 && r.seed.checkedDraft)!;
    expect(locked).toBeDefined();
    const data = sessionReducer(initialState(), {
      type: "clear",
      messageId: locked.patientAlerts[0].messageId,
      at: AT,
      by: "ST-07",
      note: "False alarm",
    }).data;
    const after = applySession(rows, data).find((r) => r.messageId === locked.messageId)!;
    expect(after).toMatchObject({ status: "ready", sendable: true });
    expect(after.lock).toBeUndefined();
    expect(replyPermission(after)).toBe("send_draft");
  });

  describe("a living patient who mentions a death (MSG-0172: her brother died, she is taking more oil than prescribed)", () => {
    const clear: SessionAction = { type: "clear", messageId: "MSG-0172", at: AT, by: "ST-07", note: "Spoke to her GP; no concern." };
    const held = ["MSG-0078", "MSG-0102", "MSG-0103"];
    const find = (desk: ReturnType<typeof applySession>, id: string) => desk.find((r) => r.messageId === id)!;

    it("is an urgent adverse event, and her other replies are held clinician first, never withdrawn", () => {
      const r = rows.find((x) => x.messageId === "MSG-0172")!;
      expect(r).toMatchObject({ route: "urgent", holdOrders: true, category: "adverse_event" });
      expect(r.reason.category).toBe("adverse_event");
      expect(r.reason.summary).toMatch(/^Adverse event: /);
      // The death is still on record, so the clinician screen can say "Mentions a death".
      expect(r.seed.safety).toContain("bereavement");
      expect(r.seed.safety).toContain("adverse_event");
      const desk = applySession(rows, emptyData());
      for (const id of held) {
        const x = find(desk, id);
        expect(x.status, id).not.toBe("withdrawn");
        expect(x.status, id).not.toBe("ready");
        expect(x.lock?.kind, id).toBe("check_clinician");
        expect(x.lock?.messageId, id).toBe("MSG-0172");
        expect(replyPermission(x), id).toBe("blocked");
        expect(x.patientAlerts.map((a) => a.kind), id).toEqual(["urgent_safety"]);
      }
      expect(find(desk, "MSG-0078").status).toBe("check_first");
    });

    it("the queue says a false-alarm clear keeps no other alert", () => {
      const item = buildQueue(deskResults, deskMessages).find((q) => q.messageId === "MSG-0172")!;
      expect(item.falseAlarmKeepsAlert).toBe(false);
      expect(clearKeepsAlert(rows.find((x) => x.messageId === "MSG-0172")!)).toBe(false);
    });

    it("the seed carries the living-patient reading, so the browser rebuild agrees with the build", () => {
      const r = rows.find((x) => x.messageId === "MSG-0172")!;
      expect(r.seed.livingPatient).toBe(true);
      expect(r.falseAlarmKeepsAlert).toBe(false);
      // Only messages the rules read as a living patient's carry the flag.
      for (const x of rows.filter((o) => o.seed.livingPatient)) expect(x.seed.safety, x.messageId).toContain("bereavement");
      // Every row's copied flag matches what the seed alone says.
      for (const x of rows) expect(clearKeepsAlert(x), x.messageId).toBe(x.falseAlarmKeepsAlert);
    });

    it("without the flag, the same seed is a possible patient death whose clear keeps the other reading", () => {
      const r = rows.find((x) => x.messageId === "MSG-0172")!;
      const unflagged = { route: r.route, seed: { checkedDraft: r.seed.checkedDraft, safety: r.seed.safety } };
      expect(clearKeepsAlert(unflagged)).toBe(true);
      expect(clearKeepsAlert({ route: "urgent", seed: { checkedDraft: false, safety: ["bereavement"] } })).toBe(false);
      expect(clearKeepsAlert({ route: "clinician", seed: { checkedDraft: false, safety: ["bereavement", "side_effect"] } })).toBe(false);
    });

    it("the session's send gate refuses her held replies until a clinician has spoken to her", () => {
      const before = emptyData();
      expect(canSendReply(rows, before, "MSG-0078")).toBe(false);
      expect(canSendReply(rows, before, "MSG-0103")).toBe(false);
      expect(canSendReply(rows, before, "MSG-0172")).toBe(false);
      const spoke = [{ type: "call", messageId: "MSG-0172", at: AT, by: "ST-07", outcome: CALL_SPOKE }] as SessionAction[];
      const after = spoke.reduce(sessionReducer, initialState()).data;
      expect(canSendReply(rows, after, "MSG-0078")).toBe(true);
      expect(canSendReply(rows, after, "MSG-0103")).toBe(true);
      // Once sent, a second send is refused.
      const sent = sessionReducer({ ...initialState(), data: after }, { type: "send", messageId: "MSG-0078", at: AT, by: "ST-01", text: "Hi" }).data;
      expect(canSendReply(rows, sent, "MSG-0078")).toBe(false);
    });

    it("a missed call keeps them held; speaking to her releases them", () => {
      const missed = [{ type: "call", messageId: "MSG-0172", at: AT, by: "ST-07", outcome: CALL_NO_ANSWER }] as SessionAction[];
      const d1 = applySession(rows, missed.reduce(sessionReducer, initialState()).data);
      for (const id of held) expect(find(d1, id).lock?.kind, id).toBe("check_clinician");
      const spoke = [...missed, { type: "call", messageId: "MSG-0172", at: AT, by: "ST-07", outcome: CALL_SPOKE }] as SessionAction[];
      const d2 = applySession(rows, spoke.reduce(sessionReducer, initialState()).data);
      expect(find(d2, "MSG-0078")).toMatchObject({ status: "ready", sendable: true });
      // In the run with Claude, MSG-0103 has a draft that passed the fact check, so once released it can be sent.
      expect(replyPermission(find(d2, "MSG-0103"))).toBe("send_draft");
    });

    it("a false-alarm clear releases her replies, like any other false alarm", () => {
      const desk = applySession(rows, sessionReducer(initialState(), clear).data);
      expect(find(desk, "MSG-0078")).toMatchObject({ status: "ready", sendable: true });
      for (const id of held) expect(find(desk, id).status, id).not.toBe("withdrawn");
      expect(find(desk, "MSG-0172")).toMatchObject({ status: "urgent", cleared: true, clearKeepsAlert: false, inClinicianQueue: true });
    });

    it("a bereavement-only false alarm still releases everything", () => {
      const only = rows.find(
        (r) =>
          r.route === "urgent" &&
          r.seed.safety.join() === "bereavement" &&
          rows.some((o) => o.patientId === r.patientId && o.status === "withdrawn"),
      )!;
      expect(only).toBeDefined();
      expect(clearKeepsAlert(only)).toBe(false);
      const desk = applySession(rows, sessionReducer(initialState(), { ...clear, messageId: only.messageId } as SessionAction).data);
      for (const r of desk.filter((o) => o.patientId === only.patientId && o.messageId !== only.messageId)) {
        expect(r.status, r.messageId).not.toBe("withdrawn");
      }
      expect(find(desk, only.messageId).clearKeepsAlert).toBe(false);
    });
  });

  describe("a clinician in touch lifts check-first locks", () => {
    const run = (...actions: SessionAction[]) => actions.reduce(sessionReducer, initialState()).data;
    const call = (messageId: string): SessionAction => ({ type: "call", messageId, at: AT, by: "ST-07", outcome: "Spoke to the patient" });
    const reply = (messageId: string): SessionAction => ({ type: "reply", messageId, at: AT, by: "ST-07", text: "We have been in touch." });
    /** Rows whose only lock comes from one other message, a check-first lock. */
    const single = (r: (typeof rows)[number]) =>
      r.lock?.kind === "check_clinician" && new Set(r.patientAlerts.map((a) => a.messageId)).size === 1;

    it("a call releases a checked draft and keeps the alert as context", () => {
      const locked = rows.find((r) => r.status === "check_first" && single(r))!;
      expect(locked).toBeDefined();
      const after = applySession(rows, run(call(locked.lock!.messageId))).find((r) => r.messageId === locked.messageId)!;
      expect(after).toMatchObject({ status: "ready", sendable: true });
      expect(after.lock).toBeUndefined();
      expect(replyPermission(after)).toBe("send_draft");
      expect(after.patientAlerts).toEqual(locked.patientAlerts);
    });

    it("a clinician reply releases a person reply, so the agent can write it", () => {
      const locked = rows.find((r) => r.status === "needs_person" && single(r))!;
      expect(locked).toBeDefined();
      expect(replyPermission(locked)).toBe("blocked");
      const after = applySession(rows, run(reply(locked.lock!.messageId))).find((r) => r.messageId === locked.messageId)!;
      expect(after.lock).toBeUndefined();
      expect(replyPermission(after)).toBe("write_reply");
    });

    it("a call with no answer keeps the lock (MSG-0176 holds MSG-0082 and MSG-0086)", () => {
      const noAnswer: SessionAction = { type: "call", messageId: "MSG-0176", at: AT, by: "ST-07", outcome: CALL_NO_ANSWER };
      const desk = applySession(rows, run(noAnswer));
      const draft = desk.find((r) => r.messageId === "MSG-0082")!;
      expect(draft).toMatchObject({ status: "check_first", sendable: false });
      expect(draft.lock?.messageId).toBe("MSG-0176");
      expect(replyPermission(draft)).toBe("blocked");
      const person = desk.find((r) => r.messageId === "MSG-0086")!;
      expect(person.lock?.kind).toBe("check_clinician");
      expect(replyPermission(person)).toBe("blocked");
      const after = applySession(rows, run(noAnswer, call("MSG-0176")));
      expect(after.find((r) => r.messageId === "MSG-0082")).toMatchObject({ status: "ready", sendable: true });
      expect(replyPermission(after.find((r) => r.messageId === "MSG-0086")!)).toBe("write_reply");
    });

    it("resuming the orders alone does not lift the lock", () => {
      const locked = rows.find((r) => r.status === "check_first" && single(r))!;
      const data = run({ type: "resumeHold", messageId: locked.lock!.messageId, at: AT, by: "ST-07", note: "Reviewed" });
      const after = applySession(rows, data).find((r) => r.messageId === locked.messageId)!;
      expect(after.lock?.kind).toBe("check_clinician");
      expect(replyPermission(after)).toBe("blocked");
    });

    it("the reported cases: MSG-0176 frees MSG-0082, MSG-0083 frees MSG-0010", () => {
      for (const [alert, other] of [
        ["MSG-0176", "MSG-0082"],
        ["MSG-0083", "MSG-0010"],
      ]) {
        const before = rows.find((r) => r.messageId === other);
        if (!before || before.lock?.messageId !== alert) continue;
        const after = applySession(rows, run(call(alert), reply(alert))).find((r) => r.messageId === other)!;
        const stillLocked = after.lock;
        if (stillLocked) expect(stillLocked.messageId).not.toBe(alert);
        else expect(replyPermission(after)).not.toBe("blocked");
      }
    });

    it("contact never lifts a withdrawal: only a false-alarm clear does", () => {
      const withdrawn = rows.filter((r) => r.status === "withdrawn");
      expect(withdrawn.length).toBeGreaterThan(0);
      const data = run(...[...new Set(rows.flatMap((r) => r.patientAlerts.map((a) => a.messageId)))].flatMap((id) => [call(id), reply(id)]));
      const desk = applySession(rows, data);
      for (const w of withdrawn) {
        const after = desk.find((r) => r.messageId === w.messageId)!;
        expect(after.status).toBe("withdrawn");
        expect(after.lock?.kind).toBe("withdrawn");
        expect(replyPermission(after)).toBe("blocked");
      }
    });

    it("contact with every alert, and nothing cleared, leaves no check-first lock", () => {
      const ids = [...new Set(rows.flatMap((r) => r.patientAlerts.map((a) => a.messageId)))];
      const desk = applySession(rows, run(...ids.map(call)));
      expect(desk.some((r) => r.lock?.kind === "check_clinician")).toBe(false);
      expect(desk.some((r) => r.status === "check_first")).toBe(false);
    });

    it("undoing the call puts the lock back", () => {
      const locked = rows.find((r) => r.status === "check_first" && single(r))!;
      const s1 = sessionReducer(initialState(), call(locked.lock!.messageId));
      const s2 = sessionReducer(s1, { type: "undo" });
      const after = applySession(rows, s2.data).find((r) => r.messageId === locked.messageId)!;
      expect(after.lock?.kind).toBe("check_clinician");
    });
  });
});
