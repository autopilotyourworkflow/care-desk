/**
 * Rehearsal round 3, checker fix P4 (lib/pipeline/check.ts, the "go/come/step/move up/down" dosing rule): MSG-0036's
 * correct appointment reply was blocked with "dosing advice: move up to" for "it is free to move up to 24 hours before
 * the consult" (P7.1), which sent it to a person. The rule is now excused only when its own clause names a consult,
 * appointment, booking or slot, has no medicine word, dose unit or amount-and-frequency word, and "up to" is followed
 * by a time frame or a day. There is no blanket exemption for "<n> hours": "you can go up to 12 hours between doses" is
 * dosing advice and stays blocked, as do "move up to 1 mL" and "go up by one drop".
 */
import { describe, expect, it } from "vitest";
import { checkDraft, clinicianReason } from "@/lib/pipeline/check";
import type { SourceRef } from "@/lib/types";
import policyData from "@/data/policy.json";

const POLICY: SourceRef[] = (policyData as { id: string; title: string; body: string }[]).map((s) => ({
  id: s.id,
  kind: "policy",
  label: `Policy ${s.id}: ${s.title}`,
  text: s.body,
}));

const dosing = (text: string) => checkDraft(text, POLICY).banned.filter((b) => /^dosing advice/.test(b));

describe("checker: moving a booking is not dosing advice (rehearsal round 3, P4)", () => {
  it("must pass: the MSG-0036 sentence", () => {
    expect(dosing("It is free to move up to 24 hours before the consult.")).toEqual([]);
    expect(dosing("Yes, your consult can be moved, and it is free to move up to 24 hours before the consult [5].")).toEqual([]);
  });

  it("must pass: the whole MSG-0036 draft, with its sources", () => {
    const sources: SourceRef[] = [
      {
        id: "APT-40003",
        kind: "appointment",
        label: "Appointment APT-40003, 18 Nov, booked",
        text: "Appointment APT-40003: follow-up consult; 18 November 2026 at 9:00 am (patient's local time); clinician Dr Anika Rao; status booked",
      },
      ...POLICY.filter((p) => p.id === "P7.1"),
    ];
    const draft =
      "Hi [FIRST_NAME],\n\nYes, your consult can be moved, and it is free to move up to 24 hours before the consult [5]. Your follow-up consult is booked for 18 November 2026 at 9:00 am with Dr Anika Rao [1].\n\nThe team will check whether the same time on the date you asked for, or another morning that week, is available and confirm the new time with you. It will stay as a phone consult.\n\nConsults run Monday to Friday 8 am to 8 pm and Saturday 9 am to 1 pm, local time [5]. You can also move it yourself in your account [5].\n\nKind regards,\n[AGENT_NAME]";
    const result = checkDraft(draft, sources);
    expect(result.banned).toEqual([]);
  });

  it("must pass: other ways of saying a booking can move", () => {
    for (const t of [
      "You can move up to 24 hours before your appointment at no cost.",
      "Your booking can move up to 2 days before the slot.",
    ]) {
      expect(dosing(t), t).toEqual([]);
    }
  });

  it("must block with the clinician reason: dose changes, with or without a time frame or a consult", () => {
    for (const t of [
      "Move up to 1 mL.",
      "You can move up to 1 mL before the consult.",
      "Go up by one drop.",
      "Go up by one drop each night.",
      "You can go up to 12 hours between doses.",
      "Go up to 12 hours between doses.",
      "Go up to 12 hours between doses before your consult.",
      "You can go up a little before your appointment.",
      "Move up to 2 capsules until your consult.",
      "Come down to half before the consult.",
    ]) {
      const r = checkDraft(t, POLICY);
      expect(r.passed, t).toBe(false);
      expect(clinicianReason(r), t).not.toBeNull();
    }
  });

  it("must block as dosing advice: the go/move up rule itself still fires next to a consult when a dose word is there", () => {
    for (const t of [
      "You can go up to 12 hours between doses.",
      "Go up to 12 hours between doses before your consult.",
      "Go up by a drop before your consult.",
      "You can step up to the higher oil before your consult.",
      "Move up to the next mL mark before your appointment.",
      "Go up to 12 hours between them before your appointment.",
      "You can go up a little before your appointment.",
    ]) {
      expect(dosing(t).length, t).toBeGreaterThan(0);
    }
  });
});
