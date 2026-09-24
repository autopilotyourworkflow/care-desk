/**
 * How the desk and the check trail show the fact check's newer fields: a fact only the patient wrote ("check first"),
 * an amount worked out from two cited ones, the note above Send, the lateness line on an order record, and the other
 * recent messages the drafter read. Pure helpers are tested directly; the components are rendered to static HTML.
 * Every patient, order and message is fictional.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CheckResult, FactCheck, PipelineResult, SourceRef } from "@/lib/types";
import type { CaseFile } from "@/lib/client/types";
import { PATIENT_MESSAGE_ID, checkDraft } from "@/lib/pipeline/check";
import { lateNoteText } from "@/lib/pipeline/retrieve";
import {
  CHECK_FIRST_SPOKEN,
  CHECK_FIRST_WORDS,
  PATIENT_MESSAGE_SOURCE,
  checkFirstCount,
  checkFirstNote,
  factState,
  factsCaption,
  orderLateNote,
  passedHeadline,
  recentMessagesLead,
  shownSourceId,
  splitLateNote,
  workedOutText,
} from "@/components/trail/facts";
import { CheckEvidence, DraftEvidence, SourceItem } from "@/components/trail/evidence";
import { CheckFirstNote, LiveCheck } from "@/components/desk/DraftBlock";
import { checkEdit } from "@/components/desk/desk-model";

const root = path.resolve(__dirname, "..");
const caseFile = (id: string) => JSON.parse(readFileSync(path.join(root, "public/data/cases", `${id}.json`), "utf8")) as CaseFile;
/** React escapes apostrophes in text as &#x27;: compare against the text as a reader sees it. */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const OWN: FactCheck = { text: "11 November", kind: "date", found: true, sourceId: PATIENT_MESSAGE_ID, fromPatient: true };
const FOUND: FactCheck = { text: "18 November 2026", kind: "date", found: true, sourceId: "APT-40003" };
const DERIVED: FactCheck = { text: "$13", kind: "amount", found: true, sourceId: "CHG-30077", derivedFrom: "NZ$162 minus NZ$149" };
const MISSING: FactCheck = { text: "60 days", kind: "duration", found: false };

const passedCheck = (facts: FactCheck[]): CheckResult => {
  const own = facts.filter((f) => f.fromPatient).length;
  return { facts, banned: [], passed: facts.every((f) => f.found), ...(own ? { checkFirst: own } : {}) };
};

describe("fact states", () => {
  it("mirrors the checker's patient-message id", () => {
    expect(PATIENT_MESSAGE_SOURCE).toBe(PATIENT_MESSAGE_ID);
  });

  it("a fact the patient wrote is check first, never found, and never shows a source", () => {
    expect(factState(OWN)).toBe("check_first");
    expect(shownSourceId(OWN)).toBeUndefined();
    // The id alone is enough, whichever flag a caller forgets.
    expect(factState({ found: true, sourceId: PATIENT_MESSAGE_ID })).toBe("check_first");
    expect(factState(FOUND)).toBe("found");
    expect(shownSourceId(FOUND)).toBe("APT-40003");
    expect(factState(MISSING)).toBe("missing");
  });

  it("names the working of a derived amount, and keeps its source", () => {
    expect(workedOutText(DERIVED)).toBe("Worked out from NZ$162 minus NZ$149");
    expect(shownSourceId(DERIVED)).toBe("CHG-30077");
    expect(workedOutText(FOUND)).toBeNull();
  });

  it("counts check-first facts from CheckResult.checkFirst", () => {
    expect(checkFirstCount(passedCheck([FOUND, OWN]))).toBe(1);
    expect(checkFirstCount({ facts: [OWN], banned: [], passed: true, checkFirst: 2 })).toBe(2);
    expect(checkFirstCount(passedCheck([FOUND]))).toBe(0);
    expect(checkFirstCount(null)).toBe(0);
  });

  it("writes the note above Send in the singular and the plural, and nothing for none", () => {
    expect(checkFirstNote(1)).toBe("1 detail comes from the patient's own message. Check it before sending.");
    expect(checkFirstNote(2)).toBe("2 details come from the patient's own message. Check them before sending.");
    expect(checkFirstNote(0)).toBeNull();
  });

  it("never says every fact matches the sources when one is the patient's own words", () => {
    expect(passedHeadline(passedCheck([FOUND]))).toBe("Fact check passed: the 1 fact matches the sources");
    expect(passedHeadline(passedCheck([FOUND, DERIVED]))).toBe("Fact check passed: all 2 facts match the sources");
    expect(passedHeadline(passedCheck([FOUND, DERIVED, OWN]))).toBe(
      "Fact check passed: 2 facts match the sources, 1 is the patient's own words",
    );
    expect(passedHeadline(passedCheck([OWN]))).toBe("Fact check passed: the 1 fact is the patient's own words");
    expect(factsCaption(passedCheck([FOUND, OWN]))).toBe("Facts in the draft: 1 of 2 found in the sources, 1 from the patient's own message");
  });

  it("introduces the other recent messages in the singular and the plural", () => {
    expect(recentMessagesLead(["MSG-0115"])).toBe("The draft also read this patient's other recent message:");
    expect(recentMessagesLead(["MSG-0014", "MSG-0030"])).toBe("The draft also read this patient's other recent messages:");
    expect(recentMessagesLead([])).toBeNull();
    expect(recentMessagesLead(undefined)).toBeNull();
  });
});

describe("the lateness line on an order record", () => {
  it.each([1, 2, 5])("splits lateNoteText(%i) off the record, word for word", (n) => {
    const record = `Order ORD-20103: status shipped; estimated delivery 22 September 2026; total £112.00; ${lateNoteText(n)}`;
    expect(splitLateNote(record)).toEqual({
      text: "Order ORD-20103: status shipped; estimated delivery 22 September 2026; total £112.00",
      late: lateNoteText(n),
    });
  });

  it("leaves a record that is not late alone", () => {
    const record = "Order ORD-20004: status shipped; estimated delivery 24 September 2026; total $148.00 AUD";
    expect(splitLateNote(record)).toEqual({ text: record });
  });

  it("MSG-0181: reads the line from the order the pipeline looked up, for the patient card", () => {
    const c = caseFile("MSG-0181");
    expect(orderLateNote(c.result, "ORD-20103")).toBe(lateNoteText(1));
    expect(orderLateNote(c.result, "ORD-99999")).toBeUndefined();
  });

  it("shows it as its own line in the source list", () => {
    const source: SourceRef = {
      id: "ORD-20103",
      kind: "order",
      label: "Order ORD-20103, shipped 18 Sep",
      text: `Order ORD-20103: status shipped; total £112.00; ${lateNoteText(1)}`,
    };
    const out = html(createElement(SourceItem, { source }));
    expect(out).toContain(">Order ORD-20103: status shipped; total £112.00</p>");
    expect(out).toContain(`>${lateNoteText(1)}</p>`);
  });
});

describe("the edit path checks a reply the way the pipeline checks a draft", () => {
  it("MSG-0036: '11 November' from the patient's request is check first on an edit, not missing", () => {
    const c = caseFile("MSG-0036");
    const sources = [...(c.result.sources?.records ?? []), ...(c.result.sources?.policy ?? [])];
    const text =
      "Hi Ella,\n\nYour follow-up consult is booked for 18 November 2026 at 9:00 am. The team will look into moving it to 11 November and confirm the new time with you.\n\nKind regards,\nOlivia";
    const edited = checkEdit(text, sources, c);
    expect(edited.passed).toBe(true);
    expect(edited.checkFirst).toBe(1);
    expect(edited.facts.find((f) => f.text === "11 November")).toMatchObject({ found: true, fromPatient: true });
    // The same check without the patient's message (the old edit path) marks it missing.
    const bare = checkDraft(text, sources, { currency: c.patient.plan.currency });
    expect(bare.facts.find((f) => f.text === "11 November")?.found).toBe(false);
  });

  it("every fact check in the reply panel goes through checkEdit", () => {
    const src = readFileSync(path.join(root, "components/desk/ReplyPanel.tsx"), "utf8");
    expect(src).not.toMatch(/checkDraft\(/);
    expect(src.match(/checkEdit\(/g)?.length).toBe(3);
  });
});

describe("rendering: the trail's fact check", () => {
  const result = {
    check: passedCheck([FOUND, DERIVED, OWN]),
    sources: { records: [], policy: [] },
  } as unknown as PipelineResult;
  const out = html(createElement(CheckEvidence, { result }));

  it("never shows PATIENT_MESSAGE as a source", () => {
    expect(out).not.toContain("PATIENT_MESSAGE");
    expect(out).not.toMatch(/Source <code[^>]*>PATIENT/);
  });

  it("shows the patient's own words in butter, with the spoken words for screen readers", () => {
    expect(out).toContain(`<span aria-hidden="true">${CHECK_FIRST_WORDS}</span>`);
    expect(out).toContain(`<span class="sr-only">${CHECK_FIRST_SPOKEN}</span>`);
    expect(out).toMatch(/bg-warning-bg/);
    expect(out).toMatch(/text-warning-fg/);
    expect(out).toContain("Facts in the draft: 2 of 3 found in the sources, 1 from the patient's own message");
    expect(out).toContain("except a date or time the patient wrote themselves, which is marked check first");
  });

  it("shows a derived amount's working beside its source chip", () => {
    expect(out).toContain("Worked out from NZ$162 minus NZ$149");
    expect(out).toContain(">CHG-30077</code>");
  });

  it("keeps the old wording for a check with no patient facts", () => {
    const plain = html(createElement(CheckEvidence, { result: { ...result, check: passedCheck([FOUND]) } }));
    expect(plain).not.toContain(CHECK_FIRST_WORDS);
    expect(plain).toContain("Facts in the draft: 1 of 1 found in the sources");
    expect(plain).toContain("must appear in the sources. No dosing");
  });
});

describe("rendering: the desk's live check and the note above Send", () => {
  it("lists the patient's own words as a butter tag, not a found fact", () => {
    const out = html(createElement(LiveCheck, { check: passedCheck([FOUND, DERIVED, OWN]), pending: false, strict: true, acknowledged: false, onAcknowledge: () => {} }));
    expect(out).toContain("Fact check passed: 2 facts match the sources, 1 is the patient's own words");
    expect(out).not.toContain("PATIENT_MESSAGE");
    expect(out).toContain(CHECK_FIRST_WORDS);
    expect(out).toContain(", date, from the patient's own message, check first");
    expect(out).toContain("Worked out from NZ$162 minus NZ$149");
    expect(out).toContain(", amount, worked out from NZ$162 minus NZ$149, found in CHG-30077");
  });

  it("still names the patient's own words when another fact is missing", () => {
    const out = html(createElement(LiveCheck, { check: { ...passedCheck([MISSING, OWN]), passed: false }, pending: false, strict: false, acknowledged: false, onAcknowledge: () => {} }));
    expect(out).toContain("1 fact is not in the sources");
    expect(out).toContain(CHECK_FIRST_WORDS);
  });

  it("shows the note, with the detail, only when checkFirst > 0", () => {
    const one = html(createElement(CheckFirstNote, { check: passedCheck([FOUND, OWN]), showFacts: true }));
    expect(one).toContain("1 detail comes from the patient's own message. Check it before sending.");
    expect(one).toContain(">11 November</span>");
    const two = html(createElement(CheckFirstNote, { check: { facts: [OWN, { ...OWN, text: "Friday" }], banned: [], passed: true, checkFirst: 2 } }));
    expect(two).toContain("2 details come from the patient's own message. Check them before sending.");
    expect(html(createElement(CheckFirstNote, { check: passedCheck([FOUND]) }))).toBe("");
  });
});

describe("rendering: the other recent messages the drafter read", () => {
  it("MSG-0118: names MSG-0115 under the draft, linked to it on the desk, and not as a source", () => {
    const c = caseFile("MSG-0118");
    expect(c.result.recentMessageIds).toEqual(["MSG-0115"]);
    const out = html(createElement(DraftEvidence, { result: c.result, onCite: () => {} }));
    expect(out).toContain("The draft also read this patient's other recent message:");
    // The same href as every other message link on the desk (next/link drops the trailing slash outside the app, where
    // next.config.ts's trailingSlash is not loaded).
    expect(out).toMatch(/<a [^>]*href="\/desk\/?\?m=MSG-0115"[^>]*>MSG-0115<\/a>/);
    expect(c.result.draft?.citations.some((x) => x.sourceId === "MSG-0115")).toBe(false);
  });

  it("says nothing when the drafter read no other message", () => {
    const c = caseFile("MSG-0036");
    expect(c.result.recentMessageIds).toBeUndefined();
    expect(html(createElement(DraftEvidence, { result: c.result, onCite: () => {} }))).not.toContain("also read");
  });
});
