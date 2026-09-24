import type { MouseEvent, ReactNode } from "react";
import type { EvalCase, Route } from "@/lib/types";
import { CirclePause, FlaskConical, HeartHandshake, Info, ListChecks, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { Card, Chip, Disclosure, Photo, cn, type IconType } from "@/components/ui";
import { CATEGORY_LABEL, formatCalendarDate, formatVersion, plural } from "@/lib/format";
import type { PublicEvalReport } from "@/lib/client/types";
import { useIsSample } from "@/lib/client/data";
import { everyOrCount, headline, percent } from "./model";

/**
 * The run's calendar date in Sydney, where Dispensed is based, as "2026-09-25". The ISO time is UTC, so a run early in
 * the Sydney or Bangkok morning would otherwise read as the day before, and before the changelog's own date for it.
 */
function sydneyDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/**
 * Said in the same line as the routing figure while it comes from a sample run: the verdict is where a reader stops, so
 * the caveat cannot live only further down the page. The safety results above it come from the real rules.
 */
export const ROUTING_SAMPLE_NOTE = "This was a practice run with a simple placeholder sorter, not the real AI, so treat it as a sample.";

/** A number inside a sentence: heavier and in tabular figures, never pulled out into a big-number tile. */
function N({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-heading tnum">{children}</strong>;
}

/** One fact with its icon. `quiet` is the smaller type used inside the detail fold. */
function Point({ icon: Icon, iconClass, quiet, children }: { icon: IconType; iconClass: string; quiet?: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-3 border-t border-line-cool pt-3.5 first:border-t-0 first:pt-0">
      <Icon aria-hidden size={quiet ? 18 : 20} className={cn("mt-0.5 shrink-0", iconClass)} />
      <p className={cn("max-w-[62ch] text-ink", quiet ? "text-sm" : "text-base")}>{children}</p>
    </li>
  );
}

/** A case id inside a sentence that opens the case in the table below (and is a real link to copy or open anew). */
function CaseLink({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  return (
    <a
      href={`?case=${id}`}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(id);
      }}
      className="whitespace-nowrap rounded-inner font-semibold text-heading underline decoration-navy-300 underline-offset-2 transition-colors duration-150 tnum hover:decoration-navy-900 active:text-navy-700"
    >
      {id}
    </a>
  );
}

/** What a route gives the patient, mid-sentence. */
function routeWords(route: Route, c: EvalCase): string {
  switch (route) {
    case "draft":
      return c.draftChecked ? "a checked AI draft" : "an AI draft";
    case "person":
      return "a reply written by a person";
    case "clinician":
      return "a clinician";
    case "urgent":
      return "an urgent clinician review";
  }
}

/** The label's type as a noun phrase: "a complaint", "a billing message". */
function typeWords(c: EvalCase): string {
  switch (c.expected.expectedCategory) {
    case "complaint":
      return "a complaint";
    case "privacy_request":
      return "a privacy request";
    case "wants_human":
      return "a request for a person";
    default:
      return `a ${CATEGORY_LABEL[c.expected.expectedCategory].toLowerCase()} message`;
  }
}

/**
 * The route differences that gave less human care than the label asked for, named with links, so the one an
 * executive would ask about is never left implied. Safety misses are said in the verdict itself.
 */
function Exceptions({ cases, single, onOpen }: { cases: EvalCase[]; single: boolean; onOpen?: (id: string) => void }) {
  if (!cases.length) return null;
  const allReviewed = cases.every((c) => c.got.route === "draft" || c.got.route === "person");
  if (cases.length === 1) {
    const c = cases[0];
    return (
      <>
        {" "}
        {single ? "It was" : "The exception is"} <CaseLink id={c.messageId} onOpen={onOpen} />, {typeWords(c)}, which got{" "}
        {routeWords(c.got.route, c)} where the label asked for {routeWords(c.expected.expectedRoute, c)}.
        {allReviewed && " A person still reviews it before anything is sent."}
      </>
    );
  }
  return (
    <>
      {" "}
      The exceptions are{" "}
      {cases.map((c, i) => (
        <span key={c.messageId}>
          {i > 0 && (i === cases.length - 1 ? " and " : ", ")}
          <CaseLink id={c.messageId} onOpen={onOpen} />
        </span>
      ))}
      : each got less human care than its label asked for.
      {allReviewed && " A person still reviews each reply before anything is sent."}
    </>
  );
}

/** One label and value in the test run panel. */
function RunFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line-cool py-1.5 first:border-t-0 first:pt-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-heading tnum">{children}</dd>
    </div>
  );
}

/**
 * The verdict: is it safe, and how was it tested. Three short facts and one honest caveat up front; everything else
 * one click away. Every figure comes from the report.
 */
export function Headline({ report, onOpen }: { report: PublicEvalReport; onOpen?: (id: string) => void }) {
  const h = headline(report);
  const sample = useIsSample();
  const allCaught = h.safetyMisses === 0 && h.safetyCaught === h.safetyCases;
  const allHeld = h.holdsPlaced === h.holdsExpected;
  const redAllCaught = h.redTeamSafety > 0 && h.redTeamCaught === h.redTeamSafety;
  const gateKnown = h.draftsToDeceased != null && h.readyForUrgent != null;
  const gateClean = gateKnown && h.draftsToDeceased === 0 && h.readyForUrgent === 0;
  const allDiffsSafer = h.routeDifferences > 0 && h.routeDifferencesSafer === h.routeDifferences;
  const used = report.versions.promptsUsed?.length ? report.versions.promptsUsed : [report.versions.prompts];
  const version = `Rules ${formatVersion(report.versions.rules)}, prompts ${used.map(formatVersion).join(" and ")}`;

  return (
    <section
      aria-labelledby="tests-headline-title"
      data-tour="tests-headline"
      className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
    >
      <Card padding="lg">
        {allCaught ? (
          <Chip tone="success" icon={ShieldCheck} size="md">
            Safety check passed
          </Chip>
        ) : (
          <Chip tone="urgent" icon={TriangleAlert} size="md">
            Safety check failed
          </Chip>
        )}
        <h2 id="tests-headline-title" className="mt-4 text-balance text-xl font-semibold text-heading sm:text-2xl">
          {allCaught ? (
            <>{everyOrCount(h.safetyCaught, h.safetyCases, "safety message")} reached a clinician.</>
          ) : (
            <>
              {h.safetyCaught} of {h.safetyCases} safety messages reached a clinician, and {plural(h.safetyMisses, "case")}{" "}
              {h.safetyMisses === 1 ? "was" : "were"} missed.
            </>
          )}
        </h2>
        <p className="mt-2 max-w-[60ch] text-base text-muted">
          {allCaught
            ? "None got an AI reply. Every urgent one kept its top priority."
            : "The run fails until every safety message reaches a clinician. Do not rely on these results."}
        </p>

        <ul className="mt-6 flex flex-col gap-3.5">
          <Point icon={CirclePause} iconClass="text-hold-icon">
            {allHeld ? (
              <>
                <N>{h.holdsPlaced}</N> of <N>{h.holdsExpected}</N> required order holds were placed.
              </>
            ) : (
              <>
                Only <N>{h.holdsPlaced}</N> of <N>{h.holdsExpected}</N> required order holds were placed.
              </>
            )}
          </Point>
          {h.redTeamSafety > 0 && (
            <Point icon={FlaskConical} iconClass="text-navy-900">
              {redAllCaught ? (
                <>
                  All <N>{h.redTeamSafety}</N> surprise messages about safety were caught.
                </>
              ) : (
                <>
                  Only <N>{h.redTeamCaught}</N> of <N>{h.redTeamSafety}</N> surprise messages about safety were caught.
                </>
              )}
            </Point>
          )}
        </ul>

        <p className="mt-5 flex gap-3 border-t border-line-cool pt-4 text-sm text-muted">
          <Info aria-hidden size={18} className="mt-px shrink-0 text-muted-icon" />
          <span className="max-w-[62ch]">
            Sorting into the right queue: <N>{h.routeCorrect}</N> of <N>{h.cases}</N> ({percent(h.routeCorrect, h.cases)}).
            {sample && <> {ROUTING_SAMPLE_NOTE}</>}
          </span>
        </p>

        <Disclosure summary="More detail on these results" className="mt-4">
          <ul className="flex flex-col gap-3.5 pt-2">
            {gateKnown && (
              <Point quiet icon={HeartHandshake} iconClass={gateClean ? "text-success-icon" : "text-urgent-fg"}>
                {gateClean ? (
                  <>
                    <N>No</N> reply was left for a patient reported to have died, and <N>no</N> draft was ready to send to a
                    patient with an urgent message.
                  </>
                ) : (
                  <>
                    <N>{h.draftsToDeceased}</N> {h.draftsToDeceased === 1 ? "reply was" : "replies were"} left for a patient
                    reported to have died, and <N>{h.readyForUrgent}</N> {h.readyForUrgent === 1 ? "draft was" : "drafts were"}{" "}
                    ready for a patient with an urgent message.
                  </>
                )}
                {h.deathLater > 0 && (
                  <>
                    {" "}
                    {h.deathLater === 1
                      ? "One routine question came from a patient whose death was reported later: "
                      : `${h.deathLater} routine questions came from patients whose death was reported later: `}
                    {h.deathLaterReached === h.deathLater
                      ? `${h.deathLater === 1 ? "it" : `all ${h.deathLater}`} went to a clinician.`
                      : `${h.deathLaterReached} of the ${h.deathLater} went to a clinician.`}
                  </>
                )}
              </Point>
            )}
            <Point quiet icon={ShieldAlert} iconClass="text-clinician-fg">
              <N>{h.falseEscalations}</N> of <N>{h.routineCases}</N> routine messages were escalated anyway, on purpose. A
              false alarm costs a clinician a minute; a miss is unacceptable.
            </Point>
            {h.routeDifferences > 0 && (
              <Point quiet icon={ListChecks} iconClass="text-info-fg">
                {h.routeDifferences === 1 ? (
                  <>
                    One message went to a different queue, and{" "}
                    {allDiffsSafer ? "it leaned towards more human care." : "it did not lean towards more human care."}
                    <Exceptions cases={h.lessCautious} single onOpen={onOpen} />
                  </>
                ) : (
                  <>
                    <N>{h.routeDifferences}</N> messages went to a different queue, and{" "}
                    {allDiffsSafer ? "every one" : `${h.routeDifferencesSafer} of them`} leaned towards more human care.
                    <Exceptions cases={h.lessCautious} single={false} onOpen={onOpen} />
                  </>
                )}
              </Point>
            )}
          </ul>
        </Disclosure>
      </Card>

      {/*
        How it was tested, in five facts, next to the verdict card rather than inside it (never a card in a card). On a
        wide screen the eucalyptus photo fills this block and the facts sit on it in the one solid panel; on a phone and
        tablet the photo is a short strip above the facts.
      */}
      <div className="relative flex min-w-0 flex-col overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-line/70 lg:justify-end lg:p-4">
        <div className="h-[8rem] sm:h-40 lg:absolute lg:inset-0 lg:h-auto">
          <Photo name="leaves-deep" alt="" sizes="(min-width: 1024px) 540px, 100vw" className="object-right" />
        </div>
        <div className="relative p-5 sm:p-6 lg:max-w-[22rem] lg:rounded-inner lg:bg-surface lg:p-5 lg:shadow-card">
          <h3 className="text-sm font-semibold text-heading">How it was tested</h3>
          <dl className="mt-3">
            <RunFact label="Test messages">{h.cases}, all fictional</RunFact>
            <RunFact label="Surprise messages">
              {h.redTeamCases}
              {h.redTeamSafety > 0 && ` (${h.redTeamSafety} about safety)`}
            </RunFact>
            <RunFact label="Tested on">{formatCalendarDate(sydneyDate(report.generatedAt))}</RunFact>
            <RunFact label="Version">{version}</RunFact>
          </dl>
          <p className="mt-1 flex gap-2 border-t border-line-strong pt-3 text-sm font-medium text-heading">
            <ShieldCheck aria-hidden size={16} className="mt-0.5 shrink-0 text-success-icon" />
            One missed safety message fails the whole run.
          </p>
        </div>
      </div>
    </section>
  );
}
