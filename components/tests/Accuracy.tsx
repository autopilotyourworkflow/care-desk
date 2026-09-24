import { Fragment, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SAFETY_CATEGORIES, type Category } from "@/lib/types";
import type { EvalCase } from "@/lib/types";
import type { PublicEvalReport } from "@/lib/client/types";
import { useIsSample } from "@/lib/client/data";
import { Card, CardHeader, Disclosure, Inset, cn } from "@/components/ui";
import { CATEGORY_LABEL, formatUsd, formatNumber, plural } from "@/lib/format";
import { SAFETY_ORDER, isSafetyRoute, isStricter, laterDeathReport, percent } from "./model";

/**
 * Said under the folded routine rows while the figures come from a sample run, so they are never read as Claude's.
 * One plain sentence: where the figures come from, and that the real run replaces them.
 */
export const ROUTINE_SAMPLE_NOTE =
  "These figures come from a simple built-in stand-in, not Claude, and will be replaced by the real run, so they say nothing about real-world performance.";

/** The disclosure that holds the routine rows while they are samples. */
export const ROUTINE_SAMPLE_TITLE = "Routine sorting, sample run";

/**
 * What "not the right queue" meant for routine messages, in words read from the data. A routine message outside its
 * expected queue usually went to more human care than it needed (for example a person wrote a reply the AI could have
 * drafted); any that got less care than expected are counted and named, never folded in. Null when every routine
 * message was in its expected queue.
 */
export function routineQueueNote(cases: EvalCase[], isSafetyCategory: (c: EvalCase) => boolean): string | null {
  const off = cases.filter((c) => !isSafetyCategory(c) && !c.routeCorrect);
  if (off.length === 0) return null;
  const more = off.filter(isStricter).length;
  const lessCases = off.filter((c) => !isStricter(c));
  const less = lessCases.length;
  const example = "for example a person wrote a reply the AI could have drafted";
  const moreLine =
    more === 0
      ? ""
      : off.length === 1
        ? `The one routine message outside its expected queue went to more human care than it needed, ${example}.`
        : less === 0
          ? `All ${off.length} routine messages outside their expected queue went to more human care than they needed, ${example}.`
          : `${more} of the ${off.length} routine messages outside their expected queue went to more human care than they needed, ${example}.`;
  if (less === 0) return moreLine;
  const allDrafts = lessCases.every((c) => c.got.route === "draft");
  const what = allDrafts
    ? "got an AI draft where the label expected a person to write the reply"
    : "got less human care than the label expected";
  const who =
    more > 0 ? `The other ${less === 1 ? "one" : less}` : off.length === 1 ? "The one routine message outside its expected queue" : `All ${off.length} routine messages outside their expected queue`;
  const lessLine = `${who} ${what}.`;
  const review = allDrafts ? "A person still reads every draft before it is sent." : "";
  return [moreLine, lessLine, review].filter(Boolean).join(" ");
}

type Row = PublicEvalReport["byCategory"][number];

/** A count and its share. The hidden comma keeps "8, 100%" apart for screen readers and copied text. */
function Figure({ n, of, strong }: { n: number; of: number; strong?: boolean }) {
  return (
    <>
      <span className={strong ? "font-semibold text-heading" : "font-medium text-heading"}>{n}</span>
      <span className="sr-only">, </span>
      <span className="ml-1.5 inline-block w-9 text-right text-xs text-muted max-sm:ml-0 max-sm:block max-sm:w-auto">{percent(n, of)}</span>
    </>
  );
}

function Cell({ n, of, note }: { n: number; of: number; note?: string }) {
  return (
    <td className="py-2 pl-3 text-right align-baseline tnum">
      <Figure n={n} of={of} />
      {note && <span className="block text-xs font-medium text-info-fg">{note}</span>}
    </td>
  );
}

/** For a safety type: how many reached a clinician, and how many missed their queue only by going to urgent. */
function safetyStats(report: PublicEvalReport, category: Category) {
  const cases = report.cases.filter((c) => c.expected.expectedCategory === category);
  const reached = cases.filter((c) => isSafetyRoute(c.got.route)).length;
  const stricter = cases.filter((c) => !c.routeCorrect && isStricter(c));
  return {
    cases: cases.length,
    reached,
    stricter: stricter.length,
    toUrgent: stricter.filter((c) => c.got.route === "urgent").length,
  };
}

/** Routing and type accuracy by message type: a compact table, safety types first. */
export function ByType({ report }: { report: PublicEvalReport }) {
  const sample = useIsSample();
  const isSafety = (c: Category) => (SAFETY_CATEGORIES as readonly Category[]).includes(c);
  const safety = SAFETY_ORDER.map((c) => report.byCategory.find((r) => r.category === c)).filter((r): r is Row => !!r);
  const routine = report.byCategory.filter((r) => !isSafety(r.category));
  const all = report.byCategory.reduce(
    (a, r) => ({ cases: a.cases + r.cases, route: a.route + r.routeCorrect, type: a.type + r.categoryCorrect }),
    { cases: 0, route: 0, type: 0 },
  );
  const stats = new Map(safety.map((r) => [r.category, safetyStats(report, r.category)]));
  const safetyTotals = [...stats.values()].reduce(
    (a, s) => ({ cases: a.cases + s.cases, reached: a.reached + s.reached, stricter: a.stricter + s.stricter, toUrgent: a.toUrgent + s.toUrgent }),
    { cases: 0, reached: 0, stricter: 0, toUrgent: 0 },
  );
  const safetyMisses = safety.reduce((n, r) => n + (r.cases - r.routeCorrect), 0);
  // Said in words under the safety rows, so a queue shortfall is never read as a message that missed its clinician.
  const safetyNote =
    safetyTotals.cases === 0
      ? null
      : safetyTotals.reached < safetyTotals.cases
        ? `${safetyTotals.reached} of ${safetyTotals.cases} of these messages reached a clinician.`
        : safetyMisses === 0
          ? "Every one of these messages reached a clinician, in the queue its label expected."
          : safetyTotals.stricter === safetyMisses && safetyTotals.toUrgent === safetyMisses
            ? `Every one of these messages reached a clinician. The ${safetyMisses === 1 ? "one" : safetyMisses} outside ${safetyMisses === 1 ? "its" : "their"} expected queue went to urgent, the higher priority.`
            : "Every one of these messages reached a clinician.";
  const noteFor = (r: Row) => {
    const s = stats.get(r.category);
    if (!s || !s.stricter) return undefined;
    return s.toUrgent === s.stricter ? `${s.toUrgent} went to urgent` : `${plural(s.stricter, "stricter queue", "stricter queues")}`;
  };
  // Routine questions that had to go to a clinician because of something else in the patient's thread (a receipt
  // request from a patient whose death is reported later) sit in the routine rows. They are routine in the headline's
  // count too, so the note names them without a second safety total.
  const hidden = report.cases.filter((c) => isSafetyRoute(c.expected.expectedRoute) && !isSafety(c.expected.expectedCategory));
  const hiddenReached = hidden.filter((c) => isSafetyRoute(c.got.route)).length;
  const hiddenDeath = hidden.filter((c) => !!laterDeathReport(c)).length;
  const what =
    hiddenDeath === hidden.length
      ? `${plural(hidden.length, "routine question")} from ${hidden.length === 1 ? "a patient" : "patients"} whose death was reported in a later message, so any open reply was withdrawn`
      : hiddenDeath > 0
        ? `${plural(hidden.length, "routine question")} that had to go to a clinician because of something else in the patient's thread, such as a later report of a death`
        : `${plural(hidden.length, "routine question")} that had to go to a clinician because of something else in the patient's thread`;
  const reachedLine =
    hiddenReached === hidden.length
      ? hidden.length === 1
        ? "It reached a clinician."
        : `All ${hidden.length} reached a clinician.`
      : `${hiddenReached} of the ${hidden.length} reached a clinician.`;
  const routineNote = hidden.length === 0 ? null : `These rows also hold ${what}. ${reachedLine}`;
  const queueNote = routineQueueNote(report.cases, (c) => isSafety(c.expected.expectedCategory));
  // While the results are samples, the routine rows (and the total, which mixes them in) sit folded behind one
  // disclosure under the safety rows, which use the real rules and stay in front. One click shows every figure.
  const foldRoutine = sample && routine.length > 0;
  const [routineOpen, setRoutineOpen] = useState(false);
  const foldId = useId();
  const routineShown = !foldRoutine || routineOpen;
  const groups: { title: string; rows: Row[]; note?: string | null; legend?: string | null; folded?: boolean }[] = [
    { title: "Safety messages", rows: safety, note: safetyNote },
    {
      title: "Routine messages",
      rows: routine,
      note: routineNote,
      legend: queueNote,
      folded: foldRoutine,
    },
  ];

  return (
    <Card as="section" aria-labelledby="tests-bytype-title" className="flex flex-col">
      <CardHeader
        title={<span id="tests-bytype-title">Sorting by type</span>}
        description="How often each type reached the queue its label expected."
      />
      <div className="relative -mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Routing and type accuracy by message type. Each figure is the number of cases, then the share of that type.
          </caption>
          <thead>
            <tr className="border-b border-line-cool text-left text-xs text-muted">
              <th scope="col" className="pb-2 pr-3 font-medium">
                Type
              </th>
              <th scope="col" className="pb-2 pl-3 text-right font-medium">
                Cases
              </th>
              <th scope="col" className="pb-2 pl-3 text-right font-medium">
                Right queue
              </th>
              <th scope="col" className="pb-2 pl-3 text-right font-medium">
                Right type
              </th>
            </tr>
          </thead>
          {groups.map((g) =>
            g.rows.length ? (
              <Fragment key={g.title}>
                {g.folded && (
                  <tbody>
                    <tr>
                      <td colSpan={4} className="pt-5">
                        <button
                          type="button"
                          aria-expanded={routineOpen}
                          aria-controls={`${foldId}-rows ${foldId}-total`}
                          onClick={() => setRoutineOpen((o) => !o)}
                          className="-mx-2 inline-flex min-h-9 items-start gap-1.5 rounded-inner px-2 py-1.5 text-left text-sm font-semibold text-heading transition-colors duration-150 hover:bg-navy-900/[0.06] active:bg-navy-900/10"
                        >
                          <ChevronDown
                            aria-hidden
                            size={16}
                            className={cn(
                              "mt-0.5 shrink-0 text-muted-icon transition-transform duration-200 ease-out-expo",
                              routineOpen && "rotate-180",
                            )}
                          />
                          <span>
                            {ROUTINE_SAMPLE_TITLE}
                            <span className="font-normal text-muted">
                              {`, ${plural(g.rows.length, "type")}, ${plural(g.rows.reduce((n, r) => n + r.cases, 0), "case")}`}
                            </span>
                          </span>
                        </button>
                        <p className="mt-1 max-w-prose text-xs text-muted">{ROUTINE_SAMPLE_NOTE}</p>
                      </td>
                    </tr>
                  </tbody>
                )}
              <tbody id={g.folded ? `${foldId}-rows` : undefined} hidden={g.folded ? !routineOpen : undefined}>
                <tr>
                  <th scope="rowgroup" colSpan={4} className="pb-1 pt-4 text-left text-xs font-semibold text-heading">
                    {g.title}
                  </th>
                </tr>
                {g.rows.map((r) => (
                    <tr key={r.category} className="border-b border-line-cool last:border-b-0">
                      <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                        {CATEGORY_LABEL[r.category]}
                      </th>
                      <td className="py-2 pl-3 text-right text-muted tnum">{r.cases}</td>
                      <Cell n={r.routeCorrect} of={r.cases} note={noteFor(r)} />
                      <Cell n={r.categoryCorrect} of={r.cases} />
                    </tr>
                ))}
                {g.legend && (
                  <tr>
                    <td colSpan={4} className="pb-1 pt-2.5 text-xs text-muted">
                      <span className="font-medium text-heading">Not the right queue: </span>
                      {g.legend}
                    </td>
                  </tr>
                )}
                {g.note && (
                  <tr>
                    <td colSpan={4} className="pb-1 pt-2.5 text-xs text-muted">
                      {g.note}
                    </td>
                  </tr>
                )}
              </tbody>
              </Fragment>
            ) : null,
          )}
          {/* The total mixes in the routine sample figures, so it folds with them. */}
          <tfoot id={foldRoutine ? `${foldId}-total` : undefined} hidden={!routineShown || undefined}>
            <tr className="border-t border-line-strong">
              <th scope="row" className="pt-3 pr-3 text-left font-semibold text-heading">
                All messages
              </th>
              <td className="pt-3 pl-3 text-right font-semibold text-heading tnum">{all.cases}</td>
              <td className="pt-3 pl-3 text-right tnum">
                <Figure n={all.route} of={all.cases} strong />
              </td>
              <td className="pt-3 pl-3 text-right tnum">
                <Figure n={all.type} of={all.cases} strong />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted">
        Grouped by the type on the test label. A message can reach the right queue with a different type.
      </p>
    </Card>
  );
}

/** Drafts written, passed and blocked by the fact check, as a sentence and one proportion bar. */
export function FactCheck({ report }: { report: PublicEvalReport }) {
  const t = report.totals;
  const written = t.draftsWritten;
  const passed = t.draftsPassedCheck;
  const blocked = t.draftsBlockedByCheck;
  const noDraft = Math.max(0, t.cases - written);
  const passedShare = written ? (passed / written) * 100 : 0;
  const blockedShare = written ? (blocked / written) * 100 : 0;

  return (
    <Card as="section" aria-labelledby="tests-factcheck-title" className="flex flex-col">
      <CardHeader
        title={<span id="tests-factcheck-title">Fact check</span>}
        description="Every fact in a draft is checked against the patient's records before anyone sees it."
      />
      <p className="text-base text-ink">
        The AI wrote <strong className="font-semibold text-heading tnum">{written}</strong> drafts.{" "}
        <strong className="font-semibold text-heading tnum">{passed}</strong> passed the fact check and{" "}
        <strong className="font-semibold text-heading tnum">{blocked}</strong> {blocked === 1 ? "was" : "were"} blocked.
      </p>

      {written > 0 && (
        <div className="mt-4">
          <div
            role="img"
            aria-label={`${passed} of ${written} drafts passed, ${blocked} blocked`}
            className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-pill bg-field"
          >
            {passed > 0 && <span className="h-full rounded-pill bg-success-icon" style={{ width: `${passedShare}%` }} />}
            {blocked > 0 && <span className="h-full rounded-pill bg-urgent-solid" style={{ width: `${blockedShare}%` }} />}
          </div>
          <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-pill bg-success-icon" />
              <dt>Passed</dt>
              <dd className="font-semibold text-heading tnum">{passed}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-pill bg-urgent-solid" />
              <dt>Blocked</dt>
              <dd className="font-semibold text-heading tnum">{blocked}</dd>
            </div>
          </dl>
        </div>
      )}

      <p className="mt-4 text-sm text-ink">
        The other <span className="font-semibold text-heading tnum">{formatNumber(noDraft)}</span> messages had no AI draft
        to send: they went to a person or a clinician.
      </p>

      <Disclosure summary="What the check looks for" className="mt-4">
        <Inset>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-ink marker:text-muted-icon">
            <li>Every date, amount, order number, tracking number and time frame must appear in the sources.</li>
            <li>No dosing figures and no product promotion.</li>
            <li>A blocked draft never reaches Send: a person writes that reply instead.</li>
          </ul>
          {t.avgCostUsd > 0 && (
            <p className="mt-2 text-xs text-muted tnum">Average AI cost: {formatUsd(t.avgCostUsd)} per message.</p>
          )}
        </Inset>
      </Disclosure>
    </Card>
  );
}
