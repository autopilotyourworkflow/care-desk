import { describe, expect, it } from "vitest";
import resultsData from "@/data/results.json";
import messagesData from "@/data/messages.json";
import type { PatientMessage, PipelineResult, ResultsFile } from "@/lib/types";
import { alertsFor, buildQueue } from "@/lib/fixtures/queue";
import { LIVING_PATIENT_RULE_ID, falseAlarmKeepsAlert, livingPatientSeedHit, reportsPatientDeath } from "@/lib/pipeline/death";

const results = (resultsData as unknown as ResultsFile).results;
const messages = messagesData as unknown as PatientMessage[];
const queue = buildQueue(results, messages);
const item = (id: string) => {
  const it = queue.find((q) => q.messageId === id);
  if (!it) throw new Error(`${id} is not in the queue`);
  return it;
};

describe("queue: patient-level safety state", () => {
  // Families report these patients' deaths in later messages (MSG-0124, MSG-0156, MSG-0143).
  it.each(["PT-1010", "PT-1020", "PT-1038"])("never offers Send for %s, whose death is reported", (patientId) => {
    const items = queue.filter((q) => q.patientId === patientId);
    expect(items.length).toBeGreaterThan(1);
    for (const q of items) {
      expect(q.sendable, q.messageId).toBe(false);
      expect(q.status, q.messageId).not.toBe("ready");
      expect(q.status, q.messageId).not.toBe("check_first");
    }
  });

  it("withdraws each ready draft with the reporting message named", () => {
    expect(item("MSG-0003")).toMatchObject({ status: "withdrawn", lock: { kind: "withdrawn", messageId: "MSG-0124" } });
    expect(item("MSG-0004").lock?.label).toBe("Withdrawn: bereavement reported (MSG-0156)");
    expect(item("MSG-0049")).toMatchObject({ status: "withdrawn", lock: { messageId: "MSG-0156" } });
    expect(item("MSG-0005")).toMatchObject({ status: "withdrawn", lock: { messageId: "MSG-0143" } });
    // A person reply to Grace is withdrawn too.
    expect(item("MSG-0006")).toMatchObject({ status: "withdrawn", sendable: false });
  });

  it("keeps the bereavement messages themselves in the urgent clinician queue", () => {
    for (const id of ["MSG-0124", "MSG-0156", "MSG-0143"]) {
      expect(item(id).status).toBe("urgent");
      expect(item(id).lock).toBeUndefined();
    }
  });

  it("asks for a clinician check before a draft to a patient with an open serious reaction", () => {
    // PT-1039 reported an ED visit after taking too much on 18 Sep (MSG-0047); his billing draft is MSG-0118.
    expect(item("MSG-0118")).toMatchObject({
      status: "check_first",
      sendable: false,
      lock: { kind: "check_clinician", label: "Check with clinician before sending", messageId: "MSG-0047" },
    });
  });

  it("withdraws a draft when a later message in another language reports the patient's death", () => {
    // PT-1011's wife reports his death in Portuguese (MSG-0920); his earlier missed-delivery replies must be withdrawn.
    for (const id of ["MSG-0021", "MSG-0062", "MSG-0121"]) {
      expect(item(id), id).toMatchObject({ status: "withdrawn", sendable: false, lock: { kind: "withdrawn", messageId: "MSG-0920" } });
    }
  });

  it("holds a reply when another message was held for a clinician with orders on hold", () => {
    // PT-1045 asked in Welsh about driving after her oil (MSG-0905): clinician queue, orders held.
    expect(item("MSG-0034")).toMatchObject({ sendable: false, lock: { kind: "check_clinician", messageId: "MSG-0905" } });
  });

  it("only offers Send for checked drafts with no patient-level lock", () => {
    const sendable = queue.filter((q) => q.sendable);
    expect(sendable.length).toBeGreaterThan(0);
    for (const q of sendable) {
      expect(q.route).toBe("draft");
      expect(q.result.check?.passed).toBe(true);
      expect(q.lock).toBeUndefined();
      expect(q.patientAlerts.filter((a) => a.kind === "bereavement")).toHaveLength(0);
    }
  });

  it("releases a patient's drafts once a clinician clears the alert", () => {
    const released = buildQueue(results, messages, { cleared: ["MSG-0047"] });
    expect(released.find((q) => q.messageId === "MSG-0118")).toMatchObject({ status: "ready", sendable: true });
    // A withdrawal needs every alert for the patient cleared: the death report and the earlier serious reaction.
    // PT-1030 also has red-team alerts (a crisis in MSG-0970, new confusion in MSG-0961), which this full-results queue
    // counts as hers. The desk itself never sees the red-team slice.
    const stillHeld = buildQueue(results, messages, { cleared: ["MSG-0920", "MSG-0970", "MSG-0961"] });
    expect(stillHeld.find((q) => q.messageId === "MSG-0122")).toMatchObject({ status: "check_first", lock: { messageId: "MSG-0083" } });
    const cleared = buildQueue(results, messages, { cleared: ["MSG-0083", "MSG-0920", "MSG-0970", "MSG-0961"] });
    expect(cleared.find((q) => q.messageId === "MSG-0122")).toMatchObject({ status: "ready", sendable: true });
  });

  describe("matches applyPatientHolds for results the sorter escalated", () => {
    const draft = results.find((r) => r.route === "draft" && r.check?.passed === true && !!r.draft?.text && !r.draft.declined)!;
    const other = results.find((r) => r.route === "person" && r.rules.hits.length === 0)!;
    const msg = (id: string, at: string): PatientMessage => ({ id, patientId: "PT-9002", channel: "email", receivedAt: at, body: "x" });
    const ready: PipelineResult = { ...draft, messageId: "MSG-9101" };
    const run = (escalated: PipelineResult) =>
      buildQueue([ready, escalated], [msg("MSG-9101", "2026-09-22T09:00:00+10:00"), msg("MSG-9102", "2026-09-21T09:00:00+10:00")]);

    it("offers Send when the patient's other message is routine", () => {
      expect(run({ ...other, messageId: "MSG-9102" })[0]).toMatchObject({ status: "ready", sendable: true });
    });

    it("asks for a check when the sorter routed another message urgent with a side effect label", () => {
      const sort = { ...(other.sort ?? draft.sort!), category: "side_effect" as const, route: "urgent" as const, holdOrders: true };
      const urgent: PipelineResult = { ...other, messageId: "MSG-9102", route: "urgent", holdOrders: true, rules: { matched: false, hits: [] }, sort };
      const [q] = run(urgent);
      expect(q).toMatchObject({ status: "check_first", sendable: false, lock: { kind: "check_clinician", messageId: "MSG-9102" } });
      expect(q.lock?.detail).toContain("marked urgent");
    });

    it("asks for a check when another message went to a clinician with orders on hold", () => {
      const sort = { ...(other.sort ?? draft.sort!), category: "clinical_question" as const, route: "clinician" as const, holdOrders: true };
      const held: PipelineResult = { ...other, messageId: "MSG-9102", route: "clinician", holdOrders: true, rules: { matched: false, hits: [] }, sort };
      const [q] = run(held);
      expect(q).toMatchObject({ status: "check_first", sendable: false, lock: { kind: "check_clinician", messageId: "MSG-9102" } });
      expect(q.lock?.detail).toContain("orders on hold");
    });

    it("does not hold for a clinician result without an order hold", () => {
      const sort = { ...(other.sort ?? draft.sort!), category: "clinical_question" as const, route: "clinician" as const, holdOrders: false };
      const clin: PipelineResult = { ...other, messageId: "MSG-9102", route: "clinician", holdOrders: false, rules: { matched: false, hits: [] }, sort };
      expect(run(clin)[0]).toMatchObject({ status: "ready", sendable: true });
    });
  });

  it("MSG-0172: a living patient who mentions a death holds her other replies clinician first, never withdraws them", () => {
    const alert = item("MSG-0172");
    expect(alert).toMatchObject({ status: "urgent", falseAlarmKeepsAlert: false });
    // PT-1036 also has a later red-team crisis (MSG-0964), which this full-results queue counts as hers; with it cleared
    // the desk's own reading of MSG-0172 shows. The desk itself never sees the red-team slice.
    const own = buildQueue(results, messages, { cleared: ["MSG-0964"] });
    for (const id of ["MSG-0078", "MSG-0102", "MSG-0103"]) {
      const q = own.find((x) => x.messageId === id)!;
      expect(q.status, id).not.toBe("withdrawn");
      expect(q.sendable, id).toBe(false);
      expect(q.lock, id).toMatchObject({ kind: "check_clinician", messageId: "MSG-0172" });
      expect(q.lock?.detail, id).toContain("a possible serious reaction");
      expect(q.patientAlerts.map((a) => a.kind), id).toEqual(["urgent_safety"]);
    }
    expect(own.find((x) => x.messageId === "MSG-0078")?.status).toBe("check_first");
  });

  it("MSG-0120: Mele signing a message about her father's death holds her other replies clinician first, never withdraws them", () => {
    for (const id of ["MSG-0002", "MSG-0044"]) {
      const it = item(id);
      expect(it, id).toMatchObject({ sendable: false, lock: { kind: "check_clinician", messageId: "MSG-0120" } });
      expect(it.status, id).not.toBe("withdrawn");
      expect(it.lock?.detail, id).toMatch(/death close to them/);
      expect(it.patientAlerts.some((a) => a.kind === "bereavement"), id).toBe(false);
    }
  });

  it("only messages that may report the patient's own death withdraw replies", () => {
    const withdrawn = queue.filter((i) => i.status === "withdrawn");
    for (const w of withdrawn) expect(w.lock?.kind, w.messageId).toBe("withdrawn");
    const triggers = new Set(withdrawn.map((w) => w.lock?.messageId));
    expect(triggers.has("MSG-0120")).toBe(false);
    expect(triggers.has("MSG-0172")).toBe(false);
  });

  describe("falseAlarmKeepsAlert", () => {
    const base = results.find((r) => r.route === "urgent" && r.rules.hits.some((h) => h.category === "bereavement"))!;
    const hit = (ruleId: string, category: PipelineResult["rules"]["hits"][number]["category"], start = 0) => ({
      ruleId,
      category,
      phrase: "x",
      start,
      end: start + 1,
    });
    const withHits = (hits: PipelineResult["rules"]["hits"]): PipelineResult => ({ ...base, sort: undefined, rules: { matched: true, hits } });

    it("is true for a possible patient death with another safety reading", () => {
      expect(falseAlarmKeepsAlert(withHits([hit("bereavement.died", "bereavement"), hit("side_effect.dizzy", "side_effect", 5)]))).toBe(true);
    });
    it("is false for a death-only report", () => {
      expect(falseAlarmKeepsAlert(withHits([hit("bereavement.died", "bereavement")]))).toBe(false);
    });
    it("is false for a living patient's report", () => {
      const living = withHits([hit("bereavement.died", "bereavement"), hit(LIVING_PATIENT_RULE_ID, "adverse_event", 5)]);
      expect(reportsPatientDeath(living)).toBe(false);
      expect(falseAlarmKeepsAlert(living)).toBe(false);
    });
    it("reads a queue seed rebuilt with the stand-in hit the same way", () => {
      const seeded = withHits([
        { ruleId: "seed.bereavement", category: "bereavement", phrase: "", start: -1, end: -1 },
        { ruleId: "seed.adverse_event", category: "adverse_event", phrase: "", start: -1, end: -1 },
        livingPatientSeedHit(),
      ]);
      expect(reportsPatientDeath(seeded)).toBe(false);
      expect(alertsFor(seeded, messages[0]).map((a) => a.kind)).toEqual(["urgent_safety"]);
    });
    it("a living-patient signal only in an earlier message does not excuse a death reported now", () => {
      const r = withHits([hit("bereavement.died", "bereavement"), { ...hit(`thread.${LIVING_PATIENT_RULE_ID}`, "adverse_event"), start: -1, end: -1 }]);
      expect(reportsPatientDeath(r)).toBe(true);
    });
  });

  it("does not let a result lock itself", () => {
    const m: PatientMessage = { id: "MSG-9001", patientId: "PT-9001", channel: "chat", receivedAt: "2026-09-23T09:00:00+10:00", body: "x" };
    const base = results.find((r) => r.route === "urgent" && r.rules.hits.some((h) => h.category === "bereavement"))!;
    const r: PipelineResult = { ...base, messageId: m.id };
    const [only] = buildQueue([r], [m]);
    expect(only.status).toBe("urgent");
    expect(only.patientAlerts).toHaveLength(0);
  });
});
