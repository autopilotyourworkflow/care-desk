/**
 * The desk's reply gate beyond locks (tests/desk-send-gate.test.ts has those): placeholders left in a reply, and what
 * the helper line under a blocked edit says and offers. Every patient and message is fictional demo material.
 */
import { describe, expect, it } from "vitest";
import { hasDraftPlaceholders, unfilledPlaceholders, UNFILLED_PLACEHOLDERS, fillDraftPlaceholders } from "@/lib/format";
import { PLACEHOLDERS } from "@/lib/pipeline/redact";
import { checkDraft, clinicianReason, policyReason } from "@/lib/pipeline/check";
import { banHelp, placeholderBlockReason, rewriteSpan } from "@/components/desk/desk-model";

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

describe("hasDraftPlaceholders: every placeholder left in a reply keeps Send off", () => {
  it("covers every stand-in the redaction step writes, plus the drafter's two name slots", () => {
    for (const p of Object.values(PLACEHOLDERS)) expect(UNFILLED_PLACEHOLDERS).toContain(p);
    expect(UNFILLED_PLACEHOLDERS).toContain("[FIRST_NAME]");
    expect(UNFILLED_PLACEHOLDERS).toContain("[AGENT_NAME]");
  });

  it("catches each one in a reply", () => {
    for (const p of UNFILLED_PLACEHOLDERS) {
      expect(hasDraftPlaceholders(`Hi Sam,\n\nWe have updated it to ${p}.\n\nKind regards,\nAna`), p).toBe(true);
    }
  });

  it("ignores case and spacing inside the brackets", () => {
    expect(hasDraftPlaceholders("Call us back on [phone].")).toBe(true);
    expect(hasDraftPlaceholders("Your [ HEALTH ID ] is on file.")).toBe(true);
    expect(hasDraftPlaceholders("Your [HEALTH_ID] is on file.")).toBe(true);
    expect(hasDraftPlaceholders("Hi [Name],")).toBe(true);
  });

  it("leaves a filled reply, citation markers and ordinary brackets alone", () => {
    expect(hasDraftPlaceholders("Hi Sam,\n\nYour order ships on 24 Sep [1].\n\nKind regards,\nAna")).toBe(false);
    expect(hasDraftPlaceholders("Your plan (the [monthly] one) renews soon.")).toBe(false);
    expect(hasDraftPlaceholders("Hi Sam, thanks for your name and phone.")).toBe(false);
    expect(hasDraftPlaceholders(fillDraftPlaceholders("Hi [FIRST_NAME],\n\n[AGENT_NAME]", "Sam", "Ana Lee"))).toBe(false);
  });

  it("lists what is left in the order it appears", () => {
    expect(unfilledPlaceholders("Card [CARD], phone [PHONE], hi [FIRST_NAME]")).toEqual(["[CARD]", "[PHONE]", "[FIRST_NAME]"]);
    expect(unfilledPlaceholders("Nothing left")).toEqual([]);
  });
});

describe("placeholderBlockReason: why Send is off, in plain words", () => {
  it("is null for a reply with nothing left to fill", () => {
    expect(placeholderBlockReason("Hi Sam,\n\nAll sorted.\n\nAna")).toBeNull();
  });

  it("keeps the short name message when only the name slots are left", () => {
    expect(placeholderBlockReason("Hi [FIRST_NAME],\n\n[AGENT_NAME]")).toBe("Fill in the name placeholders first.");
  });

  it("names a hidden detail's stand-in and says it must never reach the patient", () => {
    const one = placeholderBlockReason("We've updated your mobile to [PHONE].");
    expect(one).toBe(
      "Write out or take out [PHONE] first. [PHONE] stands for a detail hidden from the AI and must never reach the patient.",
    );
    const two = placeholderBlockReason("Hi [NAME], your card [CARD] is on file.");
    expect(two).toContain("[NAME] and [CARD]");
    expect(two).toContain("stand for a detail hidden from the AI");
    const mixed = placeholderBlockReason("Hi [FIRST_NAME], we sent it to [EMAIL].");
    expect(mixed).toMatch(/^Fill in the name placeholders, and write out or take out \[EMAIL\], first\./);
  });

  it("uses no dashes", () => {
    for (const t of ["[FIRST_NAME]", "[PHONE]", "[NAME] [CARD]", "[FIRST_NAME] [REDACTED]"]) {
      expect(placeholderBlockReason(t)).not.toMatch(DASHES);
    }
  });
});

describe("banHelp: a policy block offers a rewrite, a clinical block keeps its clinician line", () => {
  const policyCases = [
    "Hi Sam, we've updated your mobile to [PHONE].",
    "Hi Sam, please reply with your card number so I can fix it.",
    "Hi Sam, I can see the card 4111 1111 1111 1111 on file.",
    "Hi Sam, can you send me your password?",
    "Hi Sam, your data will be permanently deleted.",
  ];

  it("shows policyReason as the helper line, never the clinician line", () => {
    for (const text of policyCases) {
      const check = checkDraft(text, []);
      expect(check.banned.length, text).toBeGreaterThan(0);
      expect(clinicianReason(check), text).toBeNull();
      const help = banHelp(check);
      expect(help?.kind, text).toBe("policy");
      expect(help?.line, text).toBe(`${policyReason(check)} Rewrite that part to send.`);
      expect(help?.line, text).not.toMatch(/clinician/i);
      expect(help?.line, text).not.toMatch(DASHES);
    }
  });

  it("keeps the clinical path as it was", () => {
    const check = checkDraft("Hi Sam, don't worry about the headaches.", []);
    const help = banHelp(check);
    expect(help?.kind).toBe("clinical");
    expect(help?.line).toBe(`Take it out to send. ${clinicianReason(check)}`);
  });

  it("a clinical block wins when a reply has both kinds", () => {
    const help = banHelp({ banned: ["asks for a password: send me your password", "plays down a symptom: don't worry"] });
    expect(help?.kind).toBe("clinical");
  });

  it("falls back to a plain take-it-out line, and is null with nothing blocked", () => {
    expect(banHelp({ banned: ["promotional wording: miracle"] })).toEqual({ kind: "other", line: "Take it out to send." });
    expect(banHelp({ banned: [] })).toBeNull();
    expect(banHelp(null)).toBeNull();
  });
});

describe("rewriteSpan: 'Rewrite that part' selects the blocked words", () => {
  it("finds the words the check quoted", () => {
    const text = "Hi Sam, can you send me your password? Thanks.";
    const span = rewriteSpan(text, checkDraft(text, []).banned);
    expect(span && text.slice(span.start, span.end)).toBe("send me your password");
  });

  it("finds a placeholder left in", () => {
    const text = "Hi Sam, we've updated your mobile to [PHONE].";
    const span = rewriteSpan(text, checkDraft(text, []).banned);
    expect(span && text.slice(span.start, span.end)).toBe("[PHONE]");
  });

  it("finds a card number from its last four digits, as the check never shows it in full", () => {
    const text = "Hi Sam, I can see the card 4111 1111 1111 1234 on file.";
    const banned = checkDraft(text, []).banned;
    expect(banned).toEqual(["repeats a card number: ending 1234"]);
    const span = rewriteSpan(text, banned);
    expect(span && text.slice(span.start, span.end)).toBe("4111 1111 1111 1234");
  });

  it("skips clinical blocks, which go to a clinician instead", () => {
    const text = "Hi Sam, don't worry about the headaches.";
    expect(rewriteSpan(text, checkDraft(text, []).banned)).toBeNull();
  });
});
