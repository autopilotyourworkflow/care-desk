/**
 * Shared accessibility logic: where a toast sits so it never covers the focused element, when the Test results "/"
 * shortcut may act, and what the Try page's single live region says for each run state.
 */
import { describe, expect, it } from "vitest";
import type { PipelineResult, TrailStep } from "@/lib/types";
import { bottomClearance, pickToastSlot, type Box } from "@/components/ui/Toast";
import { searchShortcutApplies, type ShortcutKey } from "@/components/tests/CaseTable";
import { fallbackCopy, runAnnouncement } from "@/components/try/announce";
import type { RunInput, RunState } from "@/components/try/useLiveRun";

// ---------------------------------------------------------------------------------------------------------------
// Toast placement

const W = 390;
/** Phone slots: under the header and "Back to the queue" (129 to 185), and above the Send bar (650 to 706). */
const PHONE_SLOTS: Record<"top" | "bottom", Box> = {
  top: { top: 129, bottom: 185, left: 0, right: W },
  bottom: { top: 650, bottom: 706, left: 0, right: W },
};

describe("bottomClearance", () => {
  const H = 844;
  it("clears the Send, Edit and Escalate bar stuck to the bottom of a phone", () => {
    // The reported case: the bar at y 705 to 844 and the toast 16px from the bottom, over Send and Edit.
    const bar = { top: 705, bottom: 844, left: 0, right: W };
    expect(bottomClearance([bar], H, 16, 8)).toBe(147);
  });

  it("still clears the bar while it settles part way off the screen", () => {
    const moved = { top: 731, bottom: 870, left: 0, right: W };
    expect(bottomClearance([moved], H, 16, 8)).toBe(121);
  });

  it("uses the highest bar when several reach the bottom", () => {
    const phoneBar = { top: 780, bottom: 844, left: 0, right: W };
    const sendBar = { top: 705, bottom: 844, left: 0, right: W };
    expect(bottomClearance([phoneBar, sendBar], H, 16, 8)).toBe(147);
  });

  it("keeps the minimum gap with no bar, and ignores panels, hidden bars and bars off the screen", () => {
    expect(bottomClearance([], H, 16, 8)).toBe(16);
    const panel = { top: 120, bottom: 844, left: 0, right: W };
    const hidden = { top: 0, bottom: 0, left: 0, right: 0 };
    const below = { top: 900, bottom: 1000, left: 0, right: W };
    const above = { top: 400, bottom: 500, left: 0, right: W };
    expect(bottomClearance([panel, hidden, below, above], H, 16, 8)).toBe(16);
  });
});

describe("pickToastSlot", () => {
  it("keeps the usual slot when nothing is focused", () => {
    expect(pickToastSlot("top", PHONE_SLOTS, null)).toBe("top");
    expect(pickToastSlot("bottom", PHONE_SLOTS, null)).toBe("bottom");
  });

  it("moves off the heading that takes focus after Send on a phone", () => {
    // The reported case: the new message's H2 at y 178 to 234 sat under the toast.
    const heading = { top: 178, bottom: 234, left: 16, right: 374 };
    expect(pickToastSlot("top", PHONE_SLOTS, heading)).toBe("bottom");
  });

  it("stays put while the focused element is clear of it", () => {
    const button = { top: 300, bottom: 340, left: 16, right: 120 };
    expect(pickToastSlot("top", PHONE_SLOTS, button)).toBe("top");
  });

  it("goes back to the top when focus moves down to the bottom slot", () => {
    const sendBar = { top: 660, bottom: 700, left: 16, right: 110 };
    expect(pickToastSlot("top", PHONE_SLOTS, sendBar)).toBe("top");
    expect(pickToastSlot("bottom", PHONE_SLOTS, sendBar)).toBe("top");
  });

  it("only counts a real overlap: side by side on a wide screen is fine", () => {
    const wide = {
      top: { top: 72, bottom: 128, left: 24, right: 472 },
      bottom: { top: 800, bottom: 856, left: 24, right: 472 },
    };
    const replyButton = { top: 810, bottom: 850, left: 900, right: 1000 };
    expect(pickToastSlot("bottom", wide, replyButton)).toBe("bottom");
    const queueRow = { top: 790, bottom: 860, left: 16, right: 360 };
    expect(pickToastSlot("bottom", wide, queueRow)).toBe("top");
  });

  it("picks the smaller overlap when a tall field touches both slots", () => {
    const field = { top: 100, bottom: 690, left: 16, right: 374 }; // covers all of the top slot, part of the bottom
    expect(pickToastSlot("top", PHONE_SLOTS, field)).toBe("bottom");
    const whole = { top: 0, bottom: 844, left: 0, right: W }; // covers both fully: keep the usual one
    expect(pickToastSlot("top", PHONE_SLOTS, whole)).toBe("top");
  });

  it("treats touching edges as clear", () => {
    const below = { top: 185, bottom: 230, left: 0, right: W };
    expect(pickToastSlot("top", PHONE_SLOTS, below)).toBe("top");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Test results "/" shortcut

const slash = (over: Partial<ShortcutKey> = {}): ShortcutKey => ({
  key: "/",
  defaultPrevented: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...over,
});
const ON = { singleKeys: true, typing: false, overlayOpen: false };

describe("searchShortcutApplies", () => {
  it("acts on a plain / with one-key shortcuts on", () => {
    expect(searchShortcutApplies(slash(), ON)).toBe(true);
  });

  it("does nothing when one-key shortcuts are switched off (WCAG 2.1.4)", () => {
    expect(searchShortcutApplies(slash(), { ...ON, singleKeys: false })).toBe(false);
  });

  it("stands aside when something else already handled the key", () => {
    expect(searchShortcutApplies(slash({ defaultPrevented: true }), ON)).toBe(false);
  });

  it("ignores / with Ctrl, Cmd or Alt held", () => {
    expect(searchShortcutApplies(slash({ ctrlKey: true }), ON)).toBe(false);
    expect(searchShortcutApplies(slash({ metaKey: true }), ON)).toBe(false);
    expect(searchShortcutApplies(slash({ altKey: true }), ON)).toBe(false);
  });

  it("never steals a / typed in a field", () => {
    expect(searchShortcutApplies(slash(), { ...ON, typing: true })).toBe(false);
  });

  it("waits while a dialog or menu is open", () => {
    expect(searchShortcutApplies(slash(), { ...ON, overlayOpen: true })).toBe(false);
  });

  it("only answers to /", () => {
    expect(searchShortcutApplies(slash({ key: "j" }), ON)).toBe(false);
    expect(searchShortcutApplies(slash({ key: "?" }), ON)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Try page live region

const input = { patient: { id: "PT-1001", firstName: "Ava" }, text: "Where is my order?" } as unknown as RunInput;

function result(over: Partial<PipelineResult> = {}): PipelineResult {
  return {
    route: "draft",
    mode: "full",
    models: { sort: "claude", draft: "claude" },
    trail: [{ id: "decide", status: "passed", title: "Decide", summary: "Draft ready" }],
    rules: { hits: [] },
    draft: { text: "Hi Ava" },
    ...over,
  } as unknown as PipelineResult;
}

const step = (id: TrailStep["id"], summary: string): TrailStep => ({ id, status: "passed", title: id, summary });

describe("runAnnouncement", () => {
  it("says nothing before a run, so the region is present but empty", () => {
    expect(runAnnouncement({ phase: "idle" })).toBe("");
  });

  it("announces the start, then each step as it lands", () => {
    const base = { phase: "running", engine: "live", input, runId: 1 } as const;
    expect(runAnnouncement({ ...base, steps: [] })).toBe("Running the checks.");
    const one = runAnnouncement({ ...base, steps: [step("redact", "Nothing personal to hide")] });
    const two = runAnnouncement({ ...base, steps: [step("redact", "Nothing personal to hide"), step("rules", "No safety words")] });
    expect(one).toMatch(/Nothing personal to hide$/);
    expect(two).toMatch(/No safety words$/);
    expect(one).not.toBe(two);
  });

  it("announces a browser fallback once, when it starts, and not again at the end", () => {
    const fallback = { kind: "unreachable" } as const;
    const running: RunState = { phase: "running", engine: "browser", steps: [], input, fallback, runId: 2 };
    const start = runAnnouncement(running);
    expect(start).toContain("Running without the live AI.");
    expect(start).toContain("The live AI is taking a break right now.");
    const done = runAnnouncement({ phase: "done", engine: "browser", result: result(), input, fallback, runId: 2 });
    expect(done.startsWith("Finished. ")).toBe(true);
    expect(done).not.toContain("taking a break");
  });

  it("adds the fallback reason at the end when a live run only learns it then", () => {
    const done = runAnnouncement({
      phase: "done",
      engine: "live",
      result: result({ route: "person", mode: "deterministic_only", models: {} as PipelineResult["models"], draft: undefined }),
      input,
      fallback: { kind: "resting" },
      runId: 3,
    });
    expect(done).toContain("Finished.");
    expect(done).toContain("The live AI is resting right now.");
  });

  it("gives the verdict when it finishes", () => {
    const done = runAnnouncement({ phase: "done", engine: "live", result: result(), input, runId: 4 });
    expect(done).toBe("Finished. Checked draft ready. A person reviews it, then sends.");
  });

  it("reads the failure notice's words when the checks could not run", () => {
    expect(runAnnouncement({ phase: "failed", input, runId: 5 })).toMatch(/^The checks could not run\. /);
  });

  it("never uses dashes as punctuation", () => {
    const lines = [
      runAnnouncement({ phase: "failed", input, runId: 6 }),
      runAnnouncement({ phase: "done", engine: "live", result: result(), input, runId: 6 }),
      fallbackCopy({ kind: "error" }, "browser").what,
    ];
    for (const l of lines) expect(l).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("fallbackCopy", () => {
  it("says where the run happened and that the rules are real", () => {
    const f = fallbackCopy({ kind: "unreachable" }, "browser");
    expect(f.title).toBe("Running without the live AI");
    expect(f.what).toContain("in your browser");
    const sample = fallbackCopy({ kind: "resting" }, "live", result({ models: { sort: "mock", draft: "mock" } as PipelineResult["models"] }));
    expect(sample.title).toBe("Running without the live AI");
    expect(sample.what).toContain("ran exactly as on the desk");
  });
});
