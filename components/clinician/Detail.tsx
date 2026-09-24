"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, HeartCrack, Mail, MessageSquare, RotateCcw, SearchX } from "lucide-react";
import {
  Button,
  Card,
  Chip,
  DetailsHeader,
  DetailsToggle,
  EmptyState,
  HoldBadge,
  Notice,
  RiskBadge,
  Skeleton,
  SkeletonText,
  cn,
} from "@/components/ui";
import { prefersReducedMotion } from "@/components/trail/reveal";
import { COUNTRY_LABEL, formatDate, minutesSince, waitingTime } from "@/lib/format";
import { useCase, useQueue } from "@/lib/client/data";
import { useSession } from "@/lib/client/session";
import type { DeskRow } from "@/lib/client/queue";
import { deathFraming, escalatedAt, falseAlarmFit, nowFor, previewClear } from "./model";
import { supportMode, ukNation } from "./support";
import { ReasonChip } from "./ReasonChip";
import { ReasonCard } from "./ReasonCard";
import { HoldCard } from "./HoldCard";
import { CrisisCard } from "./CrisisCard";
import { BereavementCard } from "./BereavementCard";
import { ContextCard } from "./ContextCard";
import { RespondCard, type RespondHandle } from "./RespondCard";

export interface DetailProps {
  id: string;
  /** The live row for this id (session applied), when the queue has loaded and the id is on the desk. */
  row: DeskRow | undefined;
  /** Every desk row, for the patient's other messages. */
  rows: DeskRow[];
  queueReady: boolean;
  /** Move focus to the title once the item has loaded (a phone, after a row was chosen, since the list is hidden). */
  focusTitle?: boolean;
  /** The details (the order hold and the patient): hidden until Show details, then kept open from item to item. */
  detailsOpen?: boolean;
  onDetailsChange?: (open: boolean) => void;
  className?: string;
}

const XL_QUERY = "(min-width: 1280px)";

function hasSideColumn(): boolean {
  try {
    return window.matchMedia(XL_QUERY).matches;
  } catch {
    return true;
  }
}

function BackLink() {
  return (
    <Button href="/clinician/" variant="ghost" size="sm" leadingIcon={ArrowLeft} className="-ml-2 mb-3 lg:hidden">
      Clinician queue
    </Button>
  );
}

/** One escalation: why, the hold, crisis or bereavement support, the patient's context and the clinician's reply. */
export function Detail({ id, row, rows, queueReady, focusTitle, detailsOpen = false, onDetailsChange, className }: DetailProps) {
  const res = useCase(id);
  const queue = useQueue();
  const session = useSession();
  const items = queue.data?.items;
  const rowId = row?.messageId;
  // What "Mark as a false alarm" would do right now, worked out with the desk's own derivation.
  const preview = useMemo(
    () => (items && rowId ? previewClear(items, session.data, rowId) : null),
    [items, session.data, rowId],
  );
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  const respondRef = useRef<RespondHandle>(null);
  const loaded = Boolean(res.data && queueReady);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  // Below 1280px the details open after the reply, out of sight: they are brought into view and take focus.
  const [focusDetails, setFocusDetails] = useState(false);
  useEffect(() => {
    if (!focusDetails || !detailsOpen) return;
    const el = detailsRef.current;
    if (!el) return;
    setFocusDetails(false);
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [focusDetails, detailsOpen]);
  const toggleDetails = () => {
    if (!detailsOpen && !hasSideColumn()) setFocusDetails(true);
    onDetailsChange?.(!detailsOpen);
  };
  const closeDetails = () => {
    onDetailsChange?.(false);
    window.requestAnimationFrame(() => toggleRef.current?.focus());
  };
  useEffect(() => {
    if (!focusTitle || !loaded || focused.current) return;
    const h = titleRef.current;
    if (!h) return;
    focused.current = true;
    h.focus({ preventScroll: true });
  }, [focusTitle, loaded]);

  if (res.status === "error") {
    const notFound = res.error?.kind === "not_found";
    return (
      <div className={className}>
        <BackLink />
        {notFound ? (
          <Card padding="none">
            <EmptyState
              icon={SearchX}
              title="This message could not be found"
              actions={
                <Button href="/clinician/" variant="secondary" size="sm">
                  Back to the clinician queue
                </Button>
              }
            >
              The link may be out of date. Every escalation in the demo is listed in the clinician queue.
            </EmptyState>
          </Card>
        ) : (
          <Notice
            tone="error"
            role="alert"
            title="This message did not load"
            actions={
              <Button size="sm" variant="secondary" leadingIcon={RotateCcw} onClick={res.retry}>
                Try again
              </Button>
            }
          >
            {res.error?.message}
          </Notice>
        )}
      </div>
    );
  }

  const data = res.data;
  if (!data || !queueReady) return <DetailSkeleton className={className} />;

  if (data.testOnly || !row) {
    return (
      <div className={className}>
        <BackLink />
        <Notice
          tone="info"
          title="This is a test-only message"
          actions={
            <Button href="/tests/" variant="secondary" size="sm">
              Open Test results
            </Button>
          }
        >
          {data.messageId} belongs to the red-team test set. It is shown on the Test results page, not in the queues.
        </Notice>
      </div>
    );
  }

  if (!row.inClinicianQueue) {
    return (
      <div className={className}>
        <BackLink />
        <Notice
          tone="info"
          title="This message is not in the clinician queue"
          actions={
            <Button href={`/desk/?m=${row.messageId}`} variant="secondary" size="sm">
              Open it on the desk
            </Button>
          }
        >
          {row.messageId} from {row.firstName} went to the desk ({row.statusLabel}). Only messages the safety check
          stops, or an agent escalates, come here.
        </Notice>
      </div>
    );
  }

  const death = deathFraming(row, data.text, data.patient.firstName, data.result.rules.hits);
  // The patient's death leads only when nothing else points to their own care; otherwise the bereavement steps fold away.
  const bereavement = death.led;
  const deathAside = death.mentioned && !death.led;
  // When the rules read the writer as the living patient, nothing was withdrawn and the bereavement steps never apply.
  const conditionalSteps = deathAside && !death.livingPatient;
  const support = supportMode(row, data.result, death);
  const nation = ukNation(data.patient);
  const fit = falseAlarmFit(row, data.result);
  const urgent = row.status === "urgent";
  const patientRows = rows.filter((r) => r.patientId === row.patientId && r.messageId !== row.messageId);
  const lockedByThis = patientRows.filter((r) => r.lock?.messageId === row.messageId);
  const withdrawn = lockedByThis.filter((r) => r.lock?.kind === "withdrawn");
  const heldBack = lockedByThis.filter((r) => r.lock?.kind !== "withdrawn");
  const rowsById = new Map(rows.map((r) => [r.messageId, r]));
  const hideIds = new Set(death.mentioned ? withdrawn.map((r) => r.messageId) : []);
  const { patient, message } = data;
  const since = escalatedAt(row);
  const escalatedText =
    minutesSince(since, nowFor(row)) < 1 ? "Escalated just now" : `Escalated ${waitingTime(since, nowFor(row))} ago`;
  const ChannelIcon = message.channel === "email" ? Mail : MessageSquare;

  // Below xl the cards stack in this order, with the details (the hold and the patient) after them all; from xl the
  // details are a column on the right.
  const order = {
    reason: "order-1",
    support: bereavement ? "order-2" : "order-5",
    respond: "order-4",
    crisis: "order-2",
    grief: "order-6",
  };
  // Crisis or urgent medical help comes straight after the reason. For a family or a grieving patient, a note after
  // the reply, with the lines one click away.
  const supportFirst = support === "crisis" || support === "medical";
  const supportCard = support && (
    <CrisisCard
      country={patient.country}
      mode={support}
      nation={nation}
      firstName={patient.firstName}
      grieving={death.mentioned && !death.led}
      className={supportFirst ? order.crisis : order.grief}
    />
  );

  return (
    <div className={className}>
      <BackLink />
      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <RiskBadge kind={urgent ? "urgent" : "clinician"} size="md" />
            <ReasonChip row={row} size="md" />
            {deathAside && (
              <Chip tone="outline" icon={HeartCrack} size="md">
                Mentions a death
              </Chip>
            )}
            {row.holdActive && <HoldBadge size="md" />}
          </div>
          <DetailsToggle
            ref={toggleRef}
            open={detailsOpen}
            onToggle={toggleDetails}
            controls="clinician-details"
            layout="side"
            hint={`The order hold, and ${patient.firstName}'s contact details and messages`}
            className="-mr-1 shrink-0"
          />
        </div>
        <h2 ref={titleRef} tabIndex={-1} className="mt-3 text-xl font-semibold text-heading outline-none">
          {message.subject ?? `${message.channel === "email" ? "Email" : "Chat"} from ${patient.firstName}`}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <ChannelIcon aria-hidden size={14} className="text-muted-icon" />
            <span className="font-medium text-heading">
              {patient.firstName} {patient.lastName}
            </span>
          </span>
          <span>{COUNTRY_LABEL[patient.country]}</span>
          <span className="tnum">Received {formatDate(message.receivedAt, patient.timezone, "dateTimeZone")}</span>
          <span className="tnum">{escalatedText}</span>
        </p>
      </header>

      <div
        className={cn(
          "flex flex-col gap-4 xl:grid xl:items-start xl:transition-[grid-template-columns] xl:duration-300 xl:ease-out-expo",
          detailsOpen ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "xl:grid-cols-[minmax(0,1fr)_0px]",
        )}
      >
        <div className="flex flex-col gap-4 max-xl:contents">
          <ReasonCard
            row={row}
            data={data}
            death={death}
            fit={fit}
            onMarkFalseAlarm={() => respondRef.current?.openFalseAlarm()}
            className={order.reason}
          />
          {supportFirst && supportCard}
          {bereavement && (
            <BereavementCard
              row={row}
              data={data}
              withdrawn={withdrawn}
              heldAfterClear={heldBack.length}
              className={order.support}
            />
          )}
          <RespondCard
            row={row}
            data={data}
            death={death}
            fit={fit}
            preview={preview}
            handle={respondRef}
            heldBackCount={heldBack.length}
            className={order.respond}
          />
          {conditionalSteps && (
            <BereavementCard
              row={row}
              data={data}
              withdrawn={withdrawn}
              heldAfterClear={heldBack.length}
              conditional
              className={order.support}
            />
          )}
          {!supportFirst && supportCard}
        </div>
        {detailsOpen && (
          // Anchored to the right edge while the track opens, so the column is uncovered rather than squeezed.
          <section
            ref={detailsRef}
            id="clinician-details"
            tabIndex={-1}
            aria-labelledby="clinician-details-title"
            className="flex min-w-0 flex-col outline-none max-xl:order-last xl:items-end xl:overflow-x-hidden"
          >
            <div className="flex w-full animate-rise-in flex-col gap-4 xl:w-[340px] xl:shrink-0 xl:animate-panel-in">
              <DetailsHeader id="clinician-details-title" onClose={closeDetails} />
              <HoldCard row={row} data={data} death={death} />
              <ContextCard data={data} rowsById={rowsById} heldBack={heldBack} hideIds={hideIds} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export function DetailSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(className)} aria-busy="true">
      <span role="status" className="sr-only">
        Loading the message
      </span>
      <div className="mb-5">
        <div className="flex gap-2">
          <Skeleton rounded="pill" className="h-7 w-24" />
          <Skeleton rounded="pill" className="h-7 w-32" />
        </div>
        <Skeleton className="mt-3 h-7 w-2/3" />
        <Skeleton className="mt-2 h-4 w-1/2" />
      </div>
      <div className="flex flex-col gap-4">
        <Card>
          <Skeleton className="h-5 w-48" />
          <SkeletonText lines={2} className="mt-4" />
          <Skeleton className="mt-5 h-40 w-full" />
        </Card>
        <Card>
          <Skeleton className="h-5 w-36" />
          <SkeletonText lines={3} className="mt-4" />
        </Card>
      </div>
    </div>
  );
}
