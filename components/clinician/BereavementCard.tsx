"use client";

import Link from "next/link";
import { CircleCheck, HeartCrack } from "lucide-react";
import { Card, CardHeader, Chip, Disclosure, Inset, Notice, cn } from "@/components/ui";
import { formatCalendarDate, formatDate, formatMoney, plural } from "@/lib/format";
import type { CaseFile } from "@/lib/client/types";
import type { DeskRow } from "@/lib/client/queue";

type Owner = "auto" | "you" | "lead" | "none";

const OWNER: Record<Owner, { label: string; tone: "success" | "neutral" | "info" }> = {
  auto: { label: "Done automatically", tone: "success" },
  you: { label: "For you", tone: "neutral" },
  lead: { label: "Team lead", tone: "info" },
  none: { label: "Nothing to do", tone: "neutral" },
};

/** The compassionate next steps from the bereavement policy, with the drafts this message withdrew. */
export function BereavementCard({
  row,
  data,
  withdrawn,
  heldAfterClear = 0,
  conditional,
  className,
}: {
  row: DeskRow;
  data: CaseFile;
  /** Desk rows for this patient withdrawn because of this message. */
  withdrawn: DeskRow[];
  /** Replies this message still holds back "clinician first" (after a clear that kept another reading). */
  heldAfterClear?: number;
  /**
   * The death is probably not the patient's (they wrote about someone close to them, or the message is mainly about
   * their own care): the steps stay folded away, for the case where it turns out the patient has died.
   */
  conditional?: boolean;
  className?: string;
}) {
  const { patient } = data;
  const first = patient.firstName;
  const stale = row.cleared;
  const steps = <BereavementSteps row={row} data={data} withdrawn={withdrawn} stale={stale} />;

  return (
    <Card as="section" aria-labelledby="bereavement-title" className={className}>
      <CardHeader
        title={
          <span id="bereavement-title">
            {conditional ? `If it turns out ${first} has died` : "Next steps for a bereavement"}
          </span>
        }
        description={
          conditional
            ? `The message also mentions a death. These steps apply only if it was ${first}'s.`
            : `If ${first} has died, care for the family comes first. Until you have checked, nothing more goes to ${first}.`
        }
      />

      {stale && (
        <Notice tone="neutral" className="mb-4">
          {heldAfterClear
            ? `Marked as a false alarm, so these steps no longer apply. Nothing is withdrawn now, but ${plural(heldAfterClear, "reply", "replies")} to ${first} ${heldAfterClear === 1 ? "waits" : "wait"} until a clinician has been in touch.`
            : "Marked as a false alarm, so these steps no longer apply. Nothing this message held back is withdrawn now."}
        </Notice>
      )}

      {conditional ? (
        <Disclosure summary="Show the bereavement steps" icon={HeartCrack}>
          <div className="pt-2">{steps}</div>
        </Disclosure>
      ) : (
        steps
      )}
    </Card>
  );
}

function BereavementSteps({
  row,
  data,
  withdrawn,
  stale,
}: {
  row: DeskRow;
  data: CaseFile;
  withdrawn: DeskRow[];
  stale: boolean;
}) {
  const { patient } = data;
  const first = patient.firstName;
  const booked = patient.appointments.filter((a) => a.status === "booked");
  const plan = patient.plan;
  return (
      <ol className="flex flex-col">
        <Step n={1} stale={stale} title="Orders on hold" owner={row.holdOrders && !row.clinicianRecord?.holdResumed ? "auto" : "you"}>
          {row.clinicianRecord?.holdResumed
            ? `Orders were resumed by a clinician. Check nothing more ships to ${first}.`
            : `Every order for ${first} went on hold when this message arrived. Nothing is dispensed or shipped.`}
        </Step>

        <Step n={2} stale={stale} title="Stop charges, reminders and marketing" owner="you">
          Pause billing on the plan and switch off reminders and marketing for {first}. These do not stop on their own.
        </Step>

        <Step n={3} stale={stale} title="Withdraw unsent replies" owner={withdrawn.length ? "auto" : "none"}>
          {withdrawn.length ? (
            <>
              {plural(withdrawn.length, "reply", "replies")} drafted to {first} will not be sent:
              <ul className="mt-2 flex flex-col gap-1.5">
                {withdrawn.map((w) => (
                  <li key={w.messageId}>
                    <Inset className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-heading">
                          {w.subject ?? w.preview}
                        </span>
                        <span className="block text-xs text-muted tnum">
                          <Link
                            href={`/desk/?m=${w.messageId}`}
                            className="rounded-inner underline decoration-line-strong underline-offset-2 hover:text-heading hover:decoration-heading"
                          >
                            {w.messageId}
                          </Link>
                          , received {formatDate(w.receivedAt, patient.timezone, "dayShort")}
                        </span>
                      </span>
                      <Chip tone={w.lock?.kind === "withdrawn" ? "urgent" : "hold"}>
                        {w.lock?.kind === "withdrawn" ? "Withdrawn" : w.statusLabel}
                      </Chip>
                    </Inset>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>There were no unsent replies to {first}.</>
          )}
        </Step>

        <Step n={4} stale={stale} title="Cancel booked consults" owner={booked.length ? "you" : "none"}>
          {booked.length ? (
            <ul className="mt-1 flex flex-col gap-1">
              {booked.map((a) => (
                <li key={a.id} className="tnum">
                  {a.id}, {formatDate(a.at, patient.timezone, "dateTime")} with {a.clinician}
                </li>
              ))}
            </ul>
          ) : (
            <>No consults are booked.</>
          )}
        </Step>

        <Step n={5} stale={stale} title="Reply with condolences" owner="you">
          Offer condolences in plain words and do not ask for proof in the first reply. Answer only what the family
          asked.
        </Step>

        <Step n={6} stale={stale} title="Cancel the plan once the family confirms" owner="you">
          {plan.name}, {formatMoney(plan.monthlyPrice, plan.currency, { explicit: true })} a month
          {plan.nextBillingDate ? (
            <>
              , next billing <span className="tnum">{formatCalendarDate(plan.nextBillingDate)}</span>
            </>
          ) : null}
          . Refund any charge for an order that was not dispatched.
        </Step>

        <Step n={7} stale={stale} title="Only contact the family about what they ask" owner="lead" last>
          The team lead contacts the family within 1 business day, and only about what they have asked for.
        </Step>
      </ol>
  );
}

function Step({
  n,
  title,
  owner,
  last,
  stale,
  children,
}: {
  n: number;
  title: string;
  owner: Owner;
  last?: boolean;
  /** The alert was cleared as a false alarm: the step no longer applies. */
  stale?: boolean;
  children: React.ReactNode;
}) {
  const o = OWNER[owner];
  return (
    <li className={cn("relative flex gap-3 pb-4", last && "pb-0")}>
      {!last && <span aria-hidden className="absolute left-3 top-7 bottom-1 w-px bg-line-cool" />}
      <span
        aria-hidden
        className={cn(
          "relative inline-flex size-6 shrink-0 items-center justify-center rounded-pill text-xs font-semibold tnum",
          owner === "auto" && !stale ? "bg-success-bg text-success-fg" : "bg-field text-heading",
        )}
      >
        {owner === "auto" && !stale ? <CircleCheck size={14} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-sm font-semibold text-heading", stale && "line-through decoration-muted-icon")}>
            <span className="sr-only">Step {n}: </span>
            {title}
          </span>
          {stale ? <Chip tone="outline">No longer applies</Chip> : <Chip tone={o.tone}>{o.label}</Chip>}
        </p>
        <div className="mt-1 text-sm text-ink">{children}</div>
      </div>
    </li>
  );
}
