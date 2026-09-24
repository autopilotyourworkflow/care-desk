/**
 * The 1-minute tour: five short stops, then a closing card about the builder. Three stay on the desk (a checked reply,
 * the check trail beside it, a message the safety rules stopped), then Test results and the Try box. One idea per
 * stop, one or two sentences each, and every stop points at one thing on the page. Example messages are chosen at run
 * time from queue.json (and the visitor's session), so the tour keeps working when results are regenerated.
 * The closing card speaks in the builder's own voice (first person), with his photo and how to reach him.
 * Every patient and message is fictional demo material.
 */
import type { QueueRow } from "@/lib/client/types";
import type { EvalReport } from "@/lib/types";

/** The two example messages the tour deep-links to with ?m=. */
export interface TourIds {
  /** A routine order or delivery question with a checked draft. */
  routine: string;
  /** A safety message the rules stopped, with the patient's orders on hold. */
  safety: string;
}

/** Everything the copy may mention, all read from data. Missing values fall back to wording without them. */
export interface TourContext {
  routine?: Pick<QueueRow, "firstName" | "category">;
  safety?: Pick<QueueRow, "firstName" | "holdOrders" | "reason">;
  totals?: EvalReport["totals"];
}

export interface TourStop {
  id: string;
  /** 1 to 5: which step of the tour this stop is. */
  step: number;
  /** Page path with the trailing slash the static export uses. */
  path: string;
  /** Which example message to open with ?m=, if any. */
  message?: keyof TourIds;
  /** The data-tour attribute to point at. Absent on the closing card, which sits centred. */
  anchor?: string;
  /** Broader anchors to use when the stop's own anchor is not on the page (the card centres if none is). */
  fallback?: readonly string[];
  /**
   * An anchor for the card to sit over when the target is in another column, so the card never covers the column
   * the copy talks about.
   */
  park?: string;
  /** Anchors the stop's copy points at, which the card steps off when there is room (it never covers `anchor`). */
  keepClear?: readonly string[];
  /**
   * On a phone, where the card is a sheet over the bottom of the screen: the lit area runs from the line holding
   * `from` down to the bottom of the first of `to` that fits above the sheet. No stop uses it at present.
   */
  sheetSpan?: { from: string; to: readonly string[] };
  /** The closing card: not a numbered step, no anchor, the builder's thanks (first person) and how to reach him. */
  end?: boolean;
  title: (c: TourContext) => string;
  body: (c: TourContext) => string;
}

export const TOUR_STEP_COUNT = 5;

/** Short names for each step, for the live region and the paused note. */
export const STEP_NAMES = ["A checked reply", "The check trail", "A safety stop", "The test results", "Your turn"] as const;

function asked(c: TourContext): string {
  const name = c.routine?.firstName;
  const what = c.routine?.category === "delivery_problem" ? "a delivery" : "an order";
  return name ? `${name} asked about ${what}.` : `A patient asked about ${what}.`;
}

export const TOUR_STOPS: TourStop[] = [
  {
    id: "draft",
    step: 1,
    path: "/desk/",
    message: "routine",
    anchor: "desk-reply",
    fallback: ["desk-draft"],
    title: () => "The AI drafts, a person sends",
    body: (c) =>
      `${asked(c)} Care Desk drafted this reply from the patient's own records. Nothing goes out until someone presses Send.`,
  },
  {
    id: "checks",
    step: 2,
    path: "/desk/",
    message: "routine",
    anchor: "desk-trail",
    title: () => "Checked before anyone sees it",
    body: () =>
      "Every message runs through the same seven checks. The safety rules go first, before any AI, and every number in the draft is matched to the records.",
  },
  {
    id: "stop",
    step: 3,
    path: "/desk/",
    message: "safety",
    anchor: "desk-conversation",
    fallback: ["desk-reply"],
    title: () => "Anything medical goes to a clinician",
    body: (c) => {
      const name = c.safety?.firstName ?? "This patient";
      const phrase = c.safety?.reason.phrase;
      const said = phrase ? `${name} wrote “${phrase}”.` : `${name} described a possible reaction.`;
      const hold = c.safety?.holdOrders === false ? "" : " and the orders are on hold";
      return `${said} The safety rules caught it before any AI ran, so there is no draft${hold}. A clinician answers.`;
    },
  },
  {
    id: "tests",
    step: 4,
    path: "/tests/",
    anchor: "tests-headline",
    title: () => "Tested before it is trusted",
    body: (c) => {
      const t = c.totals;
      if (!t) return "A labelled set of test messages runs through the same checks. A single missed safety message fails the run.";
      const caught =
        t.safetyCaught === t.safetyCases
          ? `all ${t.safetyCases} safety messages`
          : `${t.safetyCaught} of ${t.safetyCases} safety messages`;
      return `Across ${t.cases} test messages, ${caught} went to a clinician. A single miss fails the whole run.`;
    },
  },
  {
    id: "try",
    step: 5,
    path: "/try/",
    anchor: "try-input",
    fallback: ["try-trail"],
    // Beside the message box, over the live trail (still empty at this point), so the patient picker above stays clear.
    park: "try-trail",
    title: () => "Your turn",
    body: () => "Write a message as a patient would and watch the checks run live. Please use made-up details only.",
  },
  {
    id: "team",
    step: TOUR_STEP_COUNT,
    path: "/try/",
    end: true,
    title: () => "Thanks for taking the tour",
    body: () =>
      "I'm Chanon Poovaviranon (Beam). I designed and built Care Desk, from the safety rules to the test set, and I would set it up with your team.",
  },
];

/** The numbered stops, without the closing card. */
export const NUMBERED_STOPS = TOUR_STOPS.filter((s) => !s.end);

// ---------- Choosing the example messages ----------

/** Preferred routine examples: short, clear order questions (the first one is a sample patient in the Try box). */
const ROUTINE_PREFERRED = ["MSG-0152", "MSG-0184", "MSG-0163", "MSG-0175", "MSG-0088", "MSG-0018"];
/** Preferred safety example: an urgent reaction report the rules stop, with orders on hold. */
const SAFETY_PREFERRED = ["MSG-0176", "MSG-0106", "MSG-0083"];

const ROUTINE_CATEGORIES = new Set(["order_status", "delivery_problem"]);

export function isRoutineExample(r: QueueRow): boolean {
  return r.route === "draft" && r.sendable && !r.lock && ROUTINE_CATEGORIES.has(r.category ?? "") && r.threadLength === 0;
}

export function isSafetyExample(r: QueueRow): boolean {
  return (r.route === "urgent" || r.route === "clinician") && r.reason.stoppedAt === "rules" && r.reason.phraseIn === "message";
}

function pick(rows: QueueRow[], preferred: string[], test: (r: QueueRow) => boolean, usable: (id: string) => boolean): QueueRow | undefined {
  const byId = new Map(rows.map((r) => [r.messageId, r]));
  for (const id of preferred) {
    const r = byId.get(id);
    if (r && test(r) && usable(id)) return r;
  }
  return rows.find((r) => test(r) && usable(r.messageId)) ?? rows.find(test);
}

/**
 * The tour's two example messages. Prefers messages the visitor has not already acted on, so the draft and the hold
 * are still there to point at. Falls back to the preferred ids when the queue could not load.
 */
export function resolveTourIds(
  rows: QueueRow[],
  usable: { routine: (id: string) => boolean; safety: (id: string) => boolean } = { routine: () => true, safety: () => true },
): TourIds {
  const routine = pick(rows, ROUTINE_PREFERRED, isRoutineExample, usable.routine)?.messageId ?? ROUTINE_PREFERRED[0];
  const safety =
    pick(rows, SAFETY_PREFERRED, (r) => isSafetyExample(r) && r.route === "urgent" && r.holdOrders, usable.safety)?.messageId ??
    pick(rows, SAFETY_PREFERRED, isSafetyExample, usable.safety)?.messageId ??
    SAFETY_PREFERRED[0];
  return { routine, safety };
}

/** Preferred medication question for the welcome's second example: a clinician stop at the safety rules. */
const CLINICAL_PREFERRED = ["MSG-0127", "MSG-0070", "MSG-0174", "MSG-0130"];

/** The welcome's two live examples: an order question with a checked draft, then a medication question that stops. */
export function resolveWelcomeIds(rows: QueueRow[]): { routine: string; clinical: string } {
  const routine = pick(rows, ROUTINE_PREFERRED, isRoutineExample, () => true)?.messageId ?? ROUTINE_PREFERRED[0];
  const clinical =
    pick(rows, CLINICAL_PREFERRED, (r) => isSafetyExample(r) && r.route === "clinician" && r.category === "clinical_question", () => true)
      ?.messageId ?? CLINICAL_PREFERRED[0];
  return { routine, clinical };
}

/** The URL for a stop: its path, plus ?m= for the example message. */
export function stopHref(stop: TourStop, ids: TourIds): string {
  return stop.message ? `${stop.path}?m=${encodeURIComponent(ids[stop.message])}` : stop.path;
}
