import { describe, expect, it } from "vitest";
import {
  CALL_NO_ANSWER,
  CALL_SPOKE,
  callReachedPatient,
  classifyEdit,
  clearedIds,
  contactedIds,
  emptyData,
  initialState,
  isPristine,
  parseSessionData,
  serializeSessionData,
  sessionReducer,
  UNDO_LIMIT,
  type SessionAction,
  type SessionState,
} from "@/lib/client/session-state";

const AT = "2026-09-23T11:00:00.000Z";
const JESS = "ST-01";
const ANIKA = "ST-07";

function apply(state: SessionState, ...actions: SessionAction[]): SessionState {
  return actions.reduce(sessionReducer, state);
}

describe("session reducer: agent decisions", () => {
  it("records a send with its text and offers undo", () => {
    const s = apply(initialState(), { type: "send", messageId: "MSG-0002", at: AT, by: JESS, text: "  Hi Emma, it is on its way.  " });
    expect(s.data.decisions["MSG-0002"]).toEqual({ kind: "sent", at: AT, by: JESS, text: "Hi Emma, it is on its way." });
    expect(s.undo).toHaveLength(1);
    expect(s.undo[0]).toMatchObject({ type: "send", messageId: "MSG-0002", label: "Reply sent" });
    expect(s.undo[0].before).toEqual(emptyData());
  });

  it("ignores an empty send and a second decision on the same message", () => {
    const start = initialState();
    expect(sessionReducer(start, { type: "send", messageId: "MSG-0002", at: AT, by: JESS, text: "   " })).toBe(start);
    const sent = apply(start, { type: "send", messageId: "MSG-0002", at: AT, by: JESS, text: "Done" });
    expect(sessionReducer(sent, { type: "escalate", messageId: "MSG-0002", at: AT, by: JESS })).toBe(sent);
    expect(sessionReducer(sent, { type: "sendEdited", messageId: "MSG-0002", at: AT, by: JESS, text: "x", original: "y" })).toBe(
      sent,
    );
  });

  it("records an edited send with the edited text, the original and the size of the edit", () => {
    const original = "Hi Priya, your order ORD-20014 shipped on 18 Sep with Courierline, tracking CD4829103756. Kind regards, Jess";
    const text = "Hi Priya, good news: your order ORD-20014 shipped on 18 Sep with Courierline, tracking CD4829103756. Kind regards, Jess";
    const s = apply(initialState(), { type: "sendEdited", messageId: "MSG-0152", at: AT, by: JESS, text, original });
    expect(s.data.decisions["MSG-0152"]).toEqual({ kind: "sent_edited", at: AT, by: JESS, text, original, edit: "light" });
    expect(s.undo[0].label).toBe("Edited reply sent");
  });

  it("treats a reply written from scratch as written", () => {
    const s = apply(initialState(), { type: "sendEdited", messageId: "MSG-0001", at: AT, by: JESS, text: "Hi Emma, ...", original: "" });
    expect(s.data.decisions["MSG-0001"]).toMatchObject({ kind: "sent_edited", edit: "written", original: "" });
    expect(s.undo[0].label).toBe("Reply sent");
  });

  it("escalates, with an optional reason", () => {
    const s = apply(
      initialState(),
      { type: "escalate", messageId: "MSG-0003", at: AT, by: JESS, reason: " Mentions new tablets " },
      { type: "escalate", messageId: "MSG-0004", at: AT, by: JESS, reason: "  " },
    );
    expect(s.data.decisions["MSG-0003"]).toEqual({ kind: "escalated", at: AT, by: JESS, reason: "Mentions new tablets" });
    expect(s.data.decisions["MSG-0004"]).toEqual({ kind: "escalated", at: AT, by: JESS });
    expect(s.undo.map((u) => u.label)).toEqual(["Escalated to a clinician", "Escalated to a clinician"]);
  });

  it("reassigns to someone else, never to yourself", () => {
    const start = initialState();
    expect(sessionReducer(start, { type: "reassign", messageId: "MSG-0005", at: AT, by: JESS, to: JESS })).toBe(start);
    expect(sessionReducer(start, { type: "reassign", messageId: "MSG-0005", at: AT, by: JESS, to: " " })).toBe(start);
    const s = apply(start, { type: "reassign", messageId: "MSG-0005", at: AT, by: JESS, to: "ST-04", toName: "Tui Rangi", note: "NZ" });
    expect(s.data.decisions["MSG-0005"]).toEqual({ kind: "reassigned", at: AT, by: JESS, to: "ST-04", note: "NZ" });
    expect(s.undo[0].label).toBe("Reassigned to Tui Rangi");
  });
});

describe("session reducer: clinician actions", () => {
  it("logs calls, replies and notes in order", () => {
    const s = apply(
      initialState(),
      { type: "call", messageId: "MSG-0047", at: AT, by: ANIKA, outcome: "No answer, left a message" },
      { type: "call", messageId: "MSG-0047", at: AT, by: ANIKA },
      { type: "note", messageId: "MSG-0047", at: AT, by: ANIKA, text: "Try again at 9 am" },
      { type: "reply", messageId: "MSG-0047", at: AT, by: ANIKA, text: "Hi Lucas, I tried to call you." },
    );
    const rec = s.data.clinician["MSG-0047"];
    expect(rec.calls).toEqual([
      { at: AT, by: ANIKA, outcome: "No answer, left a message" },
      { at: AT, by: ANIKA },
    ]);
    expect(rec.notes).toEqual([{ at: AT, by: ANIKA, text: "Try again at 9 am" }]);
    expect(rec.replies).toEqual([{ at: AT, by: ANIKA, text: "Hi Lucas, I tried to call you." }]);
    expect(s.undo.map((u) => u.label)).toEqual(["Call logged", "Call logged", "Note added", "Reply sent"]);
  });

  it("requires a note to resume the hold, and resumes it only once", () => {
    const start = initialState();
    expect(sessionReducer(start, { type: "resumeHold", messageId: "MSG-0047", at: AT, by: ANIKA, note: "  " })).toBe(start);
    const s = apply(start, { type: "resumeHold", messageId: "MSG-0047", at: AT, by: ANIKA, note: "Spoke to Lucas, he is well" });
    expect(s.data.clinician["MSG-0047"].holdResumed).toEqual({ at: AT, by: ANIKA, note: "Spoke to Lucas, he is well" });
    expect(sessionReducer(s, { type: "resumeHold", messageId: "MSG-0047", at: AT, by: ANIKA, note: "again" })).toBe(s);
  });

  it("ignores an empty reply or note", () => {
    const start = initialState();
    expect(sessionReducer(start, { type: "reply", messageId: "MSG-0047", at: AT, by: ANIKA, text: "" })).toBe(start);
    expect(sessionReducer(start, { type: "note", messageId: "MSG-0047", at: AT, by: ANIKA, text: " \n " })).toBe(start);
  });

  it("clears a false alarm with a note, and lists it for the queue", () => {
    const start = initialState();
    expect(sessionReducer(start, { type: "clear", messageId: "MSG-0156", at: AT, by: ANIKA, note: "" })).toBe(start);
    const s = apply(
      start,
      { type: "note", messageId: "MSG-0200", at: AT, by: ANIKA, text: "unrelated" },
      { type: "clear", messageId: "MSG-0156", at: AT, by: ANIKA, note: "It was her father who died" },
    );
    expect(clearedIds(s.data)).toEqual(["MSG-0156"]);
    expect(contactedIds(s.data)).toEqual([]);
    expect(s.undo[s.undo.length - 1].label).toBe("Marked as a false alarm");
  });
});

describe("session reducer: undo, reset, staff and hydrate", () => {
  it("undoes the last action only, one step at a time", () => {
    const s1 = apply(initialState(), { type: "send", messageId: "MSG-0002", at: AT, by: JESS, text: "One" });
    const s2 = apply(s1, { type: "escalate", messageId: "MSG-0003", at: AT, by: JESS });
    const u1 = sessionReducer(s2, { type: "undo" });
    expect(u1.data).toEqual(s1.data);
    expect(u1.undo).toHaveLength(1);
    const u2 = sessionReducer(u1, { type: "undo" });
    expect(u2.data).toEqual(emptyData());
    expect(u2.undo).toHaveLength(0);
    expect(sessionReducer(u2, { type: "undo" })).toBe(u2);
  });

  it("undoing a send lets the message be decided again", () => {
    const s = apply(
      initialState(),
      { type: "send", messageId: "MSG-0002", at: AT, by: JESS, text: "One" },
      { type: "undo" },
      { type: "escalate", messageId: "MSG-0002", at: AT, by: JESS },
    );
    expect(s.data.decisions["MSG-0002"].kind).toBe("escalated");
  });

  it("keeps a bounded undo history", () => {
    const actions: SessionAction[] = Array.from({ length: UNDO_LIMIT + 5 }, (_, i) => ({
      type: "note",
      messageId: "MSG-0047",
      at: AT,
      by: ANIKA,
      text: `note ${i}`,
    }));
    const s = apply(initialState(), ...actions);
    expect(s.undo).toHaveLength(UNDO_LIMIT);
    expect(s.data.clinician["MSG-0047"].notes).toHaveLength(UNDO_LIMIT + 5);
  });

  it("resets to empty, and the reset itself can be undone", () => {
    const busy = apply(
      initialState(),
      { type: "send", messageId: "MSG-0002", at: AT, by: JESS, text: "One" },
      { type: "resumeHold", messageId: "MSG-0047", at: AT, by: ANIKA, note: "ok" },
      { type: "setStaff", role: "agent", staffId: "ST-04" },
    );
    const reset = sessionReducer(busy, { type: "reset", at: AT });
    expect(reset.data).toEqual(emptyData());
    expect(isPristine(reset.data)).toBe(true);
    expect(reset.undo[reset.undo.length - 1]).toMatchObject({ type: "reset", label: "Demo reset" });
    expect(sessionReducer(reset, { type: "undo" }).data).toEqual(busy.data);
  });

  it("a reset with nothing to reset changes nothing", () => {
    const start = initialState();
    expect(sessionReducer(start, { type: "reset", at: AT })).toBe(start);
  });

  it("sets the signed-in staff member per role without adding an undo step", () => {
    const s = apply(initialState(), { type: "setStaff", role: "agent", staffId: "ST-05" });
    expect(s.data.staffByRole).toEqual({ agent: "ST-05" });
    expect(s.undo).toHaveLength(0);
    expect(sessionReducer(s, { type: "setStaff", role: "agent", staffId: "ST-05" })).toBe(s);
  });

  it("hydrate replaces the data and clears the undo history", () => {
    const busy = apply(initialState(), { type: "send", messageId: "MSG-0002", at: AT, by: JESS, text: "One" });
    const saved = { ...emptyData(), staffByRole: { clinician: "ST-08" } };
    const h = sessionReducer(busy, { type: "hydrate", data: saved });
    expect(h).toEqual({ data: saved, undo: [] });
  });
});

describe("session persistence", () => {
  it("round-trips through JSON", () => {
    const s = apply(
      initialState(),
      { type: "send", messageId: "MSG-0002", at: AT, by: JESS, text: "One" },
      { type: "sendEdited", messageId: "MSG-0004", at: AT, by: JESS, text: "Two", original: "Too" },
      { type: "escalate", messageId: "MSG-0003", at: AT, by: JESS, reason: "why" },
      { type: "reassign", messageId: "MSG-0005", at: AT, by: JESS, to: "ST-04" },
      { type: "call", messageId: "MSG-0047", at: AT, by: ANIKA },
      { type: "reply", messageId: "MSG-0047", at: AT, by: ANIKA, text: "Hi" },
      { type: "resumeHold", messageId: "MSG-0047", at: AT, by: ANIKA, note: "ok" },
      { type: "clear", messageId: "MSG-0156", at: AT, by: ANIKA, note: "father" },
      { type: "setStaff", role: "clinician", staffId: "ST-09" },
    );
    expect(parseSessionData(serializeSessionData(s.data))).toEqual(s.data);
  });

  it("never throws on bad input and drops malformed entries", () => {
    expect(parseSessionData(null)).toEqual(emptyData());
    expect(parseSessionData("")).toEqual(emptyData());
    expect(parseSessionData("{not json")).toEqual(emptyData());
    expect(parseSessionData(JSON.stringify({ v: 2, decisions: {} }))).toEqual(emptyData());
    expect(parseSessionData("[]")).toEqual(emptyData());
    const raw = JSON.stringify({
      v: 1,
      decisions: {
        good: { kind: "sent", at: AT, by: JESS, text: "Hi" },
        badKind: { kind: "deleted", at: AT, by: JESS },
        noText: { kind: "sent", at: AT, by: JESS },
      },
      clinician: {
        good: { calls: [], replies: [{ at: AT, by: ANIKA, text: "Hi" }], notes: [] },
        badHold: { calls: [], replies: [], notes: [], holdResumed: { at: AT, by: ANIKA } },
        notArrays: { calls: "x", replies: [], notes: [] },
      },
      staffByRole: { agent: "ST-02", lead: 7, nobody: "ST-01" },
    });
    const d = parseSessionData(raw);
    expect(Object.keys(d.decisions)).toEqual(["good"]);
    expect(Object.keys(d.clinician)).toEqual(["good"]);
    expect(d.staffByRole).toEqual({ agent: "ST-02" });
  });
});

describe("classifyEdit", () => {
  it("sorts edits into as is, light, rewritten and written", () => {
    const draft = "Hi Priya, your order shipped on 18 Sep and should arrive by 24 Sep. Kind regards, Jess";
    expect(classifyEdit(draft, draft)).toBe("as_is");
    expect(classifyEdit(draft, "Hi Priya,  your order shipped on 18 Sep and should arrive by 24 Sep! Kind regards, Jess")).toBe("as_is");
    expect(classifyEdit(draft, "Hi Priya, your order shipped on 18 Sep and should arrive by 25 Sep. Thanks, Jess")).toBe("light");
    expect(classifyEdit(draft, "Hello, please call us on the number below so we can sort this out together today.")).toBe(
      "rewritten",
    );
    expect(classifyEdit("", "Anything")).toBe("written");
  });
});

describe("contactedIds", () => {
  it("lists messages with a clinician call or reply, not notes or resumed holds alone", () => {
    const s = [
      { type: "call", messageId: "MSG-0083", at: AT, by: "ST-07" },
      { type: "reply", messageId: "MSG-0176", at: AT, by: "ST-07", text: "We spoke" },
      { type: "note", messageId: "MSG-0200", at: AT, by: "ST-07", text: "Internal" },
      { type: "resumeHold", messageId: "MSG-0201", at: AT, by: "ST-07", note: "Reviewed" },
    ].reduce((st, a) => sessionReducer(st, a as SessionAction), initialState());
    expect(contactedIds(s.data)).toEqual(["MSG-0083", "MSG-0176"]);
  });

  it("a call with no answer is not being in touch; a call that reached the patient is", () => {
    const missed = sessionReducer(initialState(), { type: "call", messageId: "MSG-0176", at: AT, by: ANIKA, outcome: CALL_NO_ANSWER });
    expect(contactedIds(missed.data)).toEqual([]);
    const twiceMissed = sessionReducer(missed, { type: "call", messageId: "MSG-0176", at: AT, by: ANIKA, outcome: CALL_NO_ANSWER });
    expect(contactedIds(twiceMissed.data)).toEqual([]);
    const spoke = sessionReducer(twiceMissed, { type: "call", messageId: "MSG-0176", at: AT, by: ANIKA, outcome: CALL_SPOKE });
    expect(contactedIds(spoke.data)).toEqual(["MSG-0176"]);
    const replied = sessionReducer(missed, { type: "reply", messageId: "MSG-0176", at: AT, by: ANIKA, text: "We tried to call." });
    expect(contactedIds(replied.data)).toEqual(["MSG-0176"]);
    expect(callReachedPatient(CALL_SPOKE)).toBe(true);
    expect(callReachedPatient(CALL_NO_ANSWER)).toBe(false);
    expect(callReachedPatient(undefined)).toBe(true);
  });
});
