/**
 * The desk's send gate (components/desk/desk-model.ts sendBlockReason) and the patient card's live sibling states
 * (liveSiblings + rowBadge). The gate is what the reply panel checks on every render and inside every send, so a lock
 * that arrives while an agent is editing switches "Send edited reply" off at once. Every patient here is fictional.
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
import type { Baseline, EvalReport, Patient, PatientMessage, ResultsFile, TestLabel } from "@/lib/types";
import type { QueueLock } from "@/lib/fixtures/queue";
import type { CaseSibling, Helpline, StaffMember } from "@/lib/client/types";
import { buildPublicData } from "@/lib/client/public-data";
import { applySession, replyPermission, type DeskRow } from "@/lib/client/queue";
import { CALL_SPOKE, initialState, sessionReducer, type SessionAction } from "@/lib/client/session-state";
import { decideView, liveSiblings, sendBlockReason } from "@/components/desk/desk-model";
import { rowBadge } from "@/components/desk/StatusBadge";

const HOLD: QueueLock = {
  kind: "check_clinician",
  label: "Check with clinician before sending",
  detail: "Another message from this patient is with a clinician.",
  messageId: "MSG-9001",
};
const WITHDRAWN: QueueLock = {
  kind: "withdrawn",
  label: "Withdrawn: bereavement reported (MSG-9002)",
  detail: "A death was reported.",
  messageId: "MSG-9002",
};

describe("sendBlockReason: can a reply go to the patient right now?", () => {
  it("lets a checked draft or a person reply go when nothing holds it", () => {
    expect(sendBlockReason({ permission: "send_draft" })).toBeNull();
    expect(sendBlockReason({ permission: "write_reply", lock: null })).toBeNull();
  });

  it("a lock wins over the permission the edit started with", () => {
    // The agent opened the editor while Send was allowed; the lock then came back (another tab, a reset, an undo).
    for (const permission of ["send_draft", "write_reply"] as const) {
      const reason = sendBlockReason({ permission, lock: HOLD });
      expect(reason).toMatch(/^Held: a clinician must be in touch/);
      expect(reason).toContain("MSG-9001");
    }
  });

  it("a withdrawal says nothing is sent, and outranks a decision", () => {
    expect(sendBlockReason({ permission: "send_draft", lock: WITHDRAWN, decided: true })).toMatch(/nothing is sent/);
  });

  it("blocks a decided or blocked message", () => {
    expect(sendBlockReason({ permission: "send_draft", decided: true })).toMatch(/already has a decision/);
    expect(sendBlockReason({ permission: "blocked" })).not.toBeNull();
  });

  it("uses plain words with no dashes", () => {
    const all = [
      sendBlockReason({ permission: "blocked", lock: HOLD }),
      sendBlockReason({ permission: "blocked", lock: WITHDRAWN }),
      sendBlockReason({ permission: "send_draft", decided: true }),
      sendBlockReason({ permission: "blocked" }),
    ];
    // En and em dashes, by code point (U+2013, U+2014).
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    for (const s of all) expect(s).not.toMatch(dashes);
  });
});

describe("decideView: the lock branch wins over the edit branch", () => {
  const base = {
    final: false,
    testOnly: false,
    safety: false,
    mode: "edit" as const,
    lock: null,
    permission: "send_draft" as const,
    hasDraft: true,
  };

  it("shows the editor while a reply may go", () => {
    expect(decideView({ ...base, sendOff: sendBlockReason(base) })).toBe("edit");
  });

  it("a lock that arrives mid-edit closes the editor at once and shows the held view", () => {
    // The panel still holds mode "edit" and the permission from when the edit began: only the lock is new.
    const state = { ...base, lock: HOLD };
    expect(decideView({ ...state, sendOff: sendBlockReason(state) })).toBe("held");
    const withdrawn = { ...base, lock: WITHDRAWN };
    expect(decideView({ ...withdrawn, sendOff: sendBlockReason(withdrawn) })).toBe("held");
  });

  it("a permission that drops to blocked closes the editor even with no lock", () => {
    const state = { ...base, permission: "blocked" as const };
    expect(decideView({ ...state, sendOff: sendBlockReason(state) })).toBe("none");
  });

  it("idle: a lock outranks a send permission that has not caught up yet", () => {
    const state = { ...base, mode: "idle" as const, lock: HOLD };
    expect(decideView({ ...state, sendOff: sendBlockReason(state) })).toBe("held");
    const free = { ...base, mode: "idle" as const };
    expect(decideView({ ...free, sendOff: null })).toBe("send");
    expect(decideView({ ...free, permission: "write_reply", sendOff: null })).toBe("write");
  });

  it("a decision, a test-only message or a safety route never shows the editor", () => {
    expect(decideView({ ...base, final: true, sendOff: "x" })).toBe("record");
    expect(decideView({ ...base, testOnly: true, sendOff: null })).toBe("test_only");
    expect(decideView({ ...base, safety: true, sendOff: null })).toBe("clinician");
  });
});

// ---------- On the real sample queue: the cross-tab race that sent a reply to a held patient ----------

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
const rows = out.queue.items;
const AT = "2026-09-23T11:00:00.000Z";
const run = (...actions: SessionAction[]) => actions.reduce(sessionReducer, initialState()).data;
const call = (messageId: string): SessionAction => ({ type: "call", messageId, at: AT, by: "ST-07", outcome: CALL_SPOKE });
/** Rows held only by one other message's check-first lock, so a single clinician call releases them. */
const single = (r: (typeof rows)[number]) =>
  r.lock?.kind === "check_clinician" && new Set(r.patientAlerts.map((a) => a.messageId)).size === 1;

describe("the gate against the live queue", () => {
  it("a call frees a held draft; undoing it (or a reset) switches Send off again, even mid-edit", () => {
    const held = rows.find((r) => r.status === "check_first" && single(r));
    expect(held).toBeDefined();
    const cause = held!.lock!.messageId;

    // Tab A: the clinician speaks to the patient. Tab B: the draft is free, so the agent opens the editor.
    const freed = applySession(rows, run(call(cause))).find((r) => r.messageId === held!.messageId)!;
    const atEditStart = replyPermission(freed);
    expect(atEditStart).toBe("send_draft");
    expect(sendBlockReason({ permission: atEditStart, lock: freed.lock })).toBeNull();

    // Tab A undoes the call (or resets the demo): the session goes back to nothing done.
    const relocked = applySession(rows, run()).find((r) => r.messageId === held!.messageId)!;
    expect(relocked.lock?.messageId).toBe(cause);
    // Even with the permission the edit started with, the lock on the live row turns Send off.
    expect(sendBlockReason({ permission: atEditStart, lock: relocked.lock })).toMatch(/^Held/);
    // And the fresh permission agrees.
    expect(sendBlockReason({ permission: replyPermission(relocked), lock: relocked.lock })).toMatch(/^Held/);
  });

  it("a person reply held by a check-first lock is never writable", () => {
    const held = rows.find((r) => r.status === "needs_person" && single(r));
    expect(held).toBeDefined();
    const desk = applySession(rows, run()).find((r) => r.messageId === held!.messageId)!;
    expect(sendBlockReason({ permission: "write_reply", lock: desk.lock })).toMatch(/^Held/);
  });
});

describe("liveSiblings: the patient card shows each other message as it stands now", () => {
  const sib = (messageId: string, statusLabel: string, testOnly = false): CaseSibling => ({
    messageId,
    receivedAt: AT,
    channel: "chat",
    preview: "",
    route: "person",
    statusLabel,
    testOnly,
  });

  it("drops test-only messages and the open message itself, and falls back while the queue loads", () => {
    const list = liveSiblings([sib("MSG-1", "Write the reply"), sib("MSG-2", "x", true), sib("MSG-3", "y")], [], "MSG-3");
    expect(list.map((s) => s.sibling.messageId)).toEqual(["MSG-1"]);
    expect(list[0].row).toBeUndefined();
  });

  it("a held person reply reads 'Held: clinician first', not its build-time 'Write the reply'", () => {
    const held = rows.find((r) => r.status === "needs_person" && single(r));
    expect(held).toBeDefined();
    const desk = applySession(rows, run());
    const [entry] = liveSiblings([sib(held!.messageId, "Write the reply")], desk, "MSG-0000");
    expect(entry.row?.messageId).toBe(held!.messageId);
    expect(rowBadge(entry.row as DeskRow).label).toBe("Held: clinician first");
  });

  it("follows this session: once a clinician has been in touch the label changes, and a send shows as Sent", () => {
    const held = rows.find((r) => r.status === "check_first" && single(r))!;
    const cause = held.lock!.messageId;
    const freed = applySession(rows, run(call(cause)));
    const [a] = liveSiblings([sib(held.messageId, "Held: clinician first")], freed, "MSG-0000");
    expect(rowBadge(a.row!).label).toBe("Ready to send");
    const sent = applySession(
      rows,
      run(call(cause), { type: "send", messageId: held.messageId, at: AT, by: "ST-01", text: "Hello" }),
    );
    const [b] = liveSiblings([sib(held.messageId, "Held: clinician first")], sent, "MSG-0000");
    expect(rowBadge(b.row!).label).toBe("Sent");
  });
});
