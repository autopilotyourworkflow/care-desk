"use client";

import Link from "next/link";
import { forwardRef, type ReactNode, type Ref } from "react";
import {
  Ban,
  CalendarDays,
  CircleCheck,
  ClipboardList,
  CornerDownRight,
  History,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  ShieldAlert,
  Stethoscope,
} from "lucide-react";
import type { OrderStatus, RuleHit } from "@/lib/types";
import type { CaseFile, CasePatient } from "@/lib/client/types";
import type { DeskRow } from "@/lib/client/queue";
import type { PatientAlert, QueueLock } from "@/lib/fixtures/queue";
import { staffName, useSession } from "@/lib/client/session";
import {
  COUNTRY_LABEL,
  DEMO_NOW,
  DEMO_NOW_MS,
  categoryLabel,
  formatCalendarDate,
  formatDate,
  formatMoney,
  waitingTime,
  zoneAbbr,
} from "@/lib/format";
import { Card, Chip, DetailsToggle, Disclosure, HoldBadge, Notice, Skeleton, SkeletonText, cn, type DetailsControl, type Tone } from "@/components/ui";
import { LoadingStatus } from "@/components/ui/Skeleton";
import {
  APPOINTMENT_KIND_LABEL,
  ORDER_STATUS_LABEL,
  PLAN_STATUS_LABEL,
  currentOrder,
  liveSiblings,
  nextAppointment,
} from "./desk-model";
import { STATUS_META, StatusBadge, rowBadge } from "./StatusBadge";
import { orderLateNote } from "@/components/trail/facts";
import { repeatsStatus } from "./QueueRail";

// ---------- Text with the matched words marked ----------

interface Range {
  start: number;
  end: number;
}

/** Marks the given ranges (indexes into `full`) inside the slice [from, to). Overlaps are merged. */
function marked(full: string, from: number, to: number, ranges: Range[]): ReactNode[] {
  const inside = ranges
    .filter((r) => r.start >= from && r.end <= to && r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of inside) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const out: ReactNode[] = [];
  let pos = from;
  merged.forEach((m, i) => {
    if (m.start > pos) out.push(<span key={`t${i}`}>{full.slice(pos, m.start)}</span>);
    out.push(<mark key={`m${i}`}>{full.slice(m.start, m.end)}</mark>);
    pos = m.end;
  });
  if (pos < to) out.push(<span key="tail">{full.slice(pos, to)}</span>);
  return out;
}

/** Hits in this message whose indexes really point at the phrase (earlier-thread hits have start < 0). */
function currentHits(text: string, hits: RuleHit[]): Range[] {
  return hits
    .filter((h) => h.start >= 0 && h.end > h.start && text.slice(h.start, h.end).toLowerCase() === h.phrase.toLowerCase())
    .map((h) => ({ start: h.start, end: h.end }));
}

function markTone(route: string): "urgent" | "clinician" | "hold" {
  return route === "urgent" ? "urgent" : route === "clinician" ? "clinician" : "hold";
}

// ---------- Panel ----------

export interface MessagePanelProps {
  data: CaseFile;
  row?: DeskRow;
  /** Show details: the check trail and the patient, hidden until asked for. The button sits beside the title. */
  details?: DetailsControl;
  /** The Show details button, so focus can go back to it when the details close from their own close button. */
  detailsToggleRef?: Ref<HTMLButtonElement>;
}

/** The top of the conversation column: patient-level alerts, then the message and the earlier thread. */
export const MessagePanel = forwardRef<HTMLHeadingElement, MessagePanelProps>(function MessagePanel(
  { data, row, details, detailsToggleRef },
  headingRef,
) {
  // The live row wins: when a clinician clears a false alarm or gets in touch, deriveQueue lifts the lock, and the
  // static case file (built before this session) must not bring it back.
  const lock = row ? row.lock : data.lock;
  const lifted = row && data.lock && data.lock.messageId !== row.lock?.messageId ? data.lock : undefined;
  const alerts = (row?.patientAlerts ?? data.patientAlerts).filter(
    (a) => a.messageId !== lock?.messageId && a.messageId !== lifted?.messageId,
  );
  return (
    <div className="flex flex-col gap-4">
      {data.testOnly && (
        <Notice
          tone="neutral"
          title="A test-only message"
          actions={
            <Link
              href={`/tests/?case=${data.messageId}`}
              className="inline-flex h-8 items-center rounded-inner bg-surface px-3 text-xs font-semibold text-heading shadow-card transition-colors duration-150 hover:bg-field"
            >
              Open it in Test results
            </Link>
          }
        >
          {data.messageId} is part of the red-team test set. It runs through the same checks, but it never reaches the
          desk queue.
        </Notice>
      )}
      {lock && <LockNotice kind={lock.kind} label={lock.label} detail={lock.detail} causeId={lock.messageId} />}
      {lifted && <LiftedNotice lock={lifted} stillLocked={Boolean(lock)} />}
      {alerts.length > 0 && <OtherAlerts alerts={alerts} />}
      <MessageCard ref={headingRef} data={data} row={row} details={details} detailsToggleRef={detailsToggleRef} />
    </div>
  );
});

function LockNotice({
  kind,
  label,
  detail,
  causeId,
}: {
  kind: "withdrawn" | "check_clinician";
  label: string;
  detail: string;
  causeId: string;
}) {
  return (
    <Notice
      tone="warning"
      icon={kind === "withdrawn" ? Ban : ShieldAlert}
      // One name for the lock everywhere: the check-first banner uses the same words as its chip in the queue.
      title={kind === "withdrawn" ? label : STATUS_META.check_first.label}
      actions={
        <>
          <CauseLink href={`/desk/?m=${causeId}`}>Open {causeId}</CauseLink>
          <CauseLink href={`/clinician/?m=${causeId}`} icon={<Stethoscope aria-hidden size={14} />}>
            See it in the clinician view
          </CauseLink>
        </>
      }
    >
      <p>{detail}</p>
      <p className="mt-1 text-xs text-warning-fg">
        {kind === "withdrawn"
          ? "Send is switched off for every message from this patient."
          : "Send is switched off here until a clinician has been in touch."}
      </p>
    </Notice>
  );
}

/** A lock from the case file that this session lifted: said once, as context, so nobody reads the old banner. */
function LiftedNotice({ lock, stillLocked }: { lock: QueueLock; stillLocked: boolean }) {
  const session = useSession();
  const rec = session.data.clinician[lock.messageId];
  const cause = lock.messageId;
  let title: string;
  let body: ReactNode = null;
  if (rec?.cleared) {
    const who = staffName(rec.cleared.by) ?? "the clinician";
    title = `${cause} was marked a false alarm`;
    body = (
      <p>
        By {who}: {rec.cleared.note}
      </p>
    );
  } else if (rec && (rec.calls.length > 0 || rec.replies.length > 0)) {
    title = `A clinician has been in touch about ${cause}`;
  } else {
    title = `The hold from ${cause} has been lifted`;
  }
  return (
    <Notice
      tone="neutral"
      icon={CircleCheck}
      title={title}
      actions={<CauseLink href={`/clinician/?m=${cause}`} icon={<Stethoscope aria-hidden size={14} />}>See it in the clinician view</CauseLink>}
    >
      {body}
      <p className={cn(body ? "mt-1" : undefined)}>
        {stillLocked ? "Another hold still applies, above." : "Send is back on for this message."}
      </p>
    </Notice>
  );
}

function CauseLink({ href, children, icon }: { href: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className="inline-flex h-8 items-center gap-1.5 rounded-inner bg-surface/80 px-3 text-xs font-semibold text-heading transition-colors duration-150 hover:bg-surface active:bg-field"
    >
      {icon}
      {children}
    </Link>
  );
}

function alertWords(a: PatientAlert): string {
  if (a.kind === "bereavement") return "reports a death";
  const cats = a.categories.filter((c) => c !== "bereavement").map((c) => categoryLabel(c).toLowerCase());
  // Only a patient writing about someone else's death raises this alert with bereavement alone (MSG-0120).
  if (!cats.length && a.categories.includes("bereavement")) {
    return a.route === "urgent" ? "was marked urgent (it mentions a death close to them)" : "is with a clinician (it mentions a death close to them)";
  }
  const what = cats.length ? cats.join(" and ") : "a safety concern";
  return a.route === "urgent" ? `was marked urgent (${what})` : `is with a clinician (${what}), orders on hold`;
}

function OtherAlerts({ alerts }: { alerts: PatientAlert[] }) {
  const unique = alerts.filter((a, i) => alerts.findIndex((b) => b.messageId === a.messageId) === i);
  return (
    <Notice tone="clinician" title={unique.length === 1 ? "Another message from this patient is with a clinician" : "Other messages from this patient are with a clinician"}>
      <ul className="flex flex-col gap-1">
        {unique.map((a) => (
          <li key={a.messageId}>
            <Link href={`/desk/?m=${a.messageId}`} scroll={false} className="font-semibold text-clinician-fg underline decoration-clinician-fg/40 underline-offset-2 hover:decoration-clinician-fg">
              {a.messageId}
            </Link>{" "}
            {alertWords(a)}.
          </li>
        ))}
      </ul>
    </Notice>
  );
}

// ---------- The message ----------

const MessageCard = forwardRef<
  HTMLHeadingElement,
  { data: CaseFile; row?: DeskRow; details?: DetailsControl; detailsToggleRef?: Ref<HTMLButtonElement> }
>(function MessageCard({ data, row, details, detailsToggleRef }, ref) {
  const m = data.message;
  const tz = data.patient.timezone;
  const isEmail = m.channel === "email";
  const hits = currentHits(data.text, data.result.rules.hits);
  const subject = isEmail && m.subject ? m.subject : undefined;
  const bodyStart = subject ? subject.length + 2 : 0;
  const tone = markTone(data.result.route);
  const ChannelIcon = isEmail ? Mail : MessageCircle;
  const title = subject ?? `Chat from ${data.patient.firstName}`;
  const showCategory = Boolean(row?.category && !repeatsStatus(row.category, rowBadge(row).label));

  return (
    <Card as="article" aria-labelledby="desk-message-title" padding="none" className="p-5 sm:p-6">
      {/* The status and the order hold show once, in the check trail's verdict beside this card (and on the queue row). */}
      {showCategory && row?.category && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Chip category={row.category} />
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <h2
          ref={ref}
          id="desk-message-title"
          tabIndex={-1}
          data-tone={tone}
          className="min-w-0 text-lg font-semibold text-heading focus:outline-none"
        >
          {subject && hits.length ? marked(data.text, 0, subject.length, hits) : title}
        </h2>
        {details && (
          <DetailsToggle ref={detailsToggleRef} {...details} className="-mr-1 shrink-0" />
        )}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tnum">
        <span className="inline-flex items-center gap-1.5">
          <ChannelIcon aria-hidden size={14} className="text-muted-icon" />
          {isEmail ? "Email" : "Chat"}
        </span>
        <span>
          {formatDate(m.receivedAt, tz, "dateTimeZone")}
          <span className="sr-only">, the patient&apos;s local time</span>
        </span>
        <span>Waiting {waitingTime(m.receivedAt)}</span>
        <code className="rounded-md bg-field px-1.5 py-0.5 font-mono text-2xs text-heading">{m.id}</code>
      </p>

      <div
        data-tone={tone}
        className="mt-4 max-w-[68ch] whitespace-pre-wrap break-words text-base leading-relaxed text-ink"
      >
        {hits.length ? marked(data.text, bodyStart, data.text.length, hits) : m.body}
      </div>
      {hits.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Highlighted: the words that stopped the checks.
        </p>
      )}

      {data.thread.length > 0 && (
        <div className="mt-5 border-t border-line-cool pt-4">
          <Disclosure
            summary={`Earlier in this conversation (${data.thread.length})`}
            icon={History}
            defaultOpen={data.thread.length <= 2}
          >
            <ol className="flex flex-col gap-3">
              {data.thread.map((e, i) => (
                <li key={e.at + i} className={cn("rounded-inner p-3", e.from === "agent" ? "bg-inset" : "bg-field/60")}>
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-heading">
                      {e.from === "agent" && <CornerDownRight aria-hidden size={13} className="text-muted-icon" />}
                      {e.from === "patient" ? data.patient.firstName : "Support team"}
                    </span>
                    <span className="text-muted tnum">{formatDate(e.at, tz, "dateTime")}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{e.body}</p>
                </li>
              ))}
            </ol>
          </Disclosure>
        </div>
      )}
    </Card>
  );
});

// ---------- The patient ----------

const PLAN_TONE: Record<string, Tone> = { active: "success", paused: "warning", cancelled: "neutral" };

/** One term and its value. The div directly inside the dl holds only the dt and dd (valid list content); the icon
 *  sits inside the dt, and a grid keeps the icon column aligned. */
function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="col-span-2 grid grid-cols-subgrid items-center text-xs font-medium text-muted">
        <span aria-hidden className="text-muted-icon">
          {icon}
        </span>
        <span>{label}</span>
      </dt>
      <dd className="col-start-2 mt-0.5 min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

/** Orders a hold can still stop. An on-hold order already says so in its own chip. */
const HOLDABLE: OrderStatus[] = ["script_pending", "dispensing"];

/** "1 × Oil, 25 mL and 1 × Capsules, 30": each item reads as one item. */
function orderItemsText(items: { name: string; qty: number }[]): string {
  const parts = items.map((it) => `${it.qty} \u00d7 ${it.name}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The patient beside the conversation: who and where, the plan and the order in play. The appointment, contact details
 * and the patient's other messages fold under "More about", one click away.
 */
export function PatientCard({ data, row, rows = [] }: { data: CaseFile; row?: DeskRow; rows?: readonly DeskRow[] }) {
  const p: CasePatient = data.patient;
  const { order, inProgress } = currentOrder(p);
  // A parcel already on its way cannot be held: say so rather than badge it "Orders on hold".
  const shippedBeforeHold = Boolean(row?.holdActive && order?.status === "shipped");
  // Past its estimated delivery date as of this message: the same line the drafter was given in the order record.
  const late = order ? orderLateNote(data.result, order.id) : undefined;
  const appt = nextAppointment(p, DEMO_NOW_MS);
  // Each other message as it stands in this session (held, withdrawn, ready, sent), the same badge the queue shows.
  // The case file's label was fixed at build time: it is only a fallback while the queue loads.
  const siblings = liveSiblings(data.siblings, rows, data.messageId);
  const localTime = `${formatDate(DEMO_NOW, p.timezone, "time")} ${zoneAbbr(DEMO_NOW, p.timezone)}`;

  return (
    <Card as="section" aria-labelledby="desk-patient-title" padding="none" className="p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="desk-patient-title" className="min-w-0 text-base font-semibold text-heading">
          {p.firstName} {p.lastName}
        </h2>
        <code className="mt-0.5 shrink-0 rounded-md bg-field px-1.5 py-0.5 font-mono text-2xs text-heading">{p.id}</code>
      </div>
      <p className="mt-0.5 text-sm text-muted">
        {p.suburb}, {COUNTRY_LABEL[p.country]}. <span className="whitespace-nowrap tnum">{localTime} there now.</span>
      </p>

      <dl className="mt-4 divide-y divide-line-cool">
        <Row icon={<ClipboardList aria-hidden size={16} />} label="Plan">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-heading">{p.plan.name}</span>
            {p.plan.status !== "active" && <Chip tone={PLAN_TONE[p.plan.status]}>{PLAN_STATUS_LABEL[p.plan.status]}</Chip>}
            {p.plan.concession && <Chip tone="info">Concession</Chip>}
          </span>
          <span className="mt-0.5 block text-muted tnum">
            {formatMoney(p.plan.monthlyPrice, p.plan.currency, { explicit: true })} a month
            {p.plan.nextBillingDate && p.plan.status !== "cancelled" && (
              <>, next billing {formatCalendarDate(p.plan.nextBillingDate)}</>
            )}
          </span>
        </Row>

        <Row icon={<Package aria-hidden size={16} />} label={inProgress ? "Current order" : "Latest order"}>
          {order ? (
            <>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-heading tnum">{order.id}</span>
                <Chip tone={order.status === "on_hold" ? "hold" : order.status === "delivered" ? "success" : "neutral"}>
                  {ORDER_STATUS_LABEL[order.status]}
                </Chip>
                {row?.holdActive && HOLDABLE.includes(order.status) && <HoldBadge />}
              </span>
              <span className="mt-0.5 block text-muted tnum">
                {orderItemsText(order.items)}.{" "}
                {order.deliveredAt
                  ? `Delivered ${formatDate(order.deliveredAt, p.timezone, "dayShort")}.`
                  : order.eta
                    ? shippedBeforeHold
                      ? `Shipped before the hold, due ${formatCalendarDate(order.eta, { noYear: true })}.`
                      : `Due ${formatCalendarDate(order.eta, { noYear: true })}.`
                    : `Placed ${formatDate(order.placedAt, p.timezone, "dayShort")}.`}
                {order.tracking && <> Tracking {order.tracking}.</>}
              </span>
              {late && <span className="mt-0.5 block text-ink">{late}.</span>}
              {order.holdReason && <span className="mt-0.5 block text-hold-fg">{order.holdReason}</span>}
            </>
          ) : (
            <span className="text-muted">No orders yet.</span>
          )}
        </Row>
      </dl>

      <Disclosure summary={`More about ${p.firstName}`} className="mt-3 border-t border-line-cool pt-3">
        <dl className="divide-y divide-line-cool">
          <Row icon={<CalendarDays aria-hidden size={16} />} label="Next appointment">
            {appt ? (
              <>
                <span className="font-medium text-heading">{APPOINTMENT_KIND_LABEL[appt.kind]}</span>
                <span className="mt-0.5 block text-muted tnum">
                  {formatDate(appt.at, p.timezone, "dateTime")} with {appt.clinician}
                </span>
              </>
            ) : (
              <span className="text-muted">None booked.</span>
            )}
          </Row>

          <Row icon={<Phone aria-hidden size={16} />} label="Contact">
            <span className="block break-all">{p.email}</span>
            <span className="block tnum">{p.phone}</span>
          </Row>

          <Row icon={<MapPin aria-hidden size={16} />} label="Lives in">
            <span className="block">
              {p.suburb}, {p.region}, {COUNTRY_LABEL[p.country]}
            </span>
          </Row>
        </dl>

        {siblings.length > 0 ? (
          <div className="mt-3 border-t border-line-cool pt-3">
            <h3 className="text-xs font-semibold text-muted">Other messages from {p.firstName}</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {siblings.map(({ sibling: s, row: live }) => (
                <li key={s.messageId}>
                  <Link
                    href={`/desk/?m=${s.messageId}`}
                    scroll={false}
                    className="-mx-2 flex items-center gap-2 rounded-inner px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-field/70 active:bg-field"
                  >
                    <span className="font-medium text-heading tnum">{s.messageId}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{s.subject ?? s.preview}</span>
                    {live ? (
                      <StatusBadge meta={rowBadge(live)} className="shrink-0" />
                    ) : (
                      s.statusLabel && <span className="shrink-0 text-xs text-muted">{s.statusLabel}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 border-t border-line-cool pt-3 text-xs text-muted">
            No other messages from {p.firstName} in the queue.
          </p>
        )}
      </Disclosure>
    </Card>
  );
}

// ---------- Loading ----------

export function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingStatus label="Loading the message" />
      <Card padding="none" className="p-5 sm:p-6">
        <div className="flex gap-1.5">
          <Skeleton rounded="pill" className="h-6 w-28" />
        </div>
        <Skeleton className="mt-4 h-5 w-2/3" />
        <Skeleton className="mt-2 h-3 w-1/2" />
        <SkeletonText lines={4} className="mt-5" />
      </Card>
    </div>
  );
}
