"use client";

import Link from "next/link";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { Card, CardHeader, Chip, Disclosure, Divider, RiskBadge, ROUTE_TO_RISK, cn } from "@/components/ui";
import { COUNTRY_LABEL, DEMO_NOW, formatCalendarDate, formatDate, formatMoney, zoneAbbr } from "@/lib/format";
import type { CaseFile, CaseSibling, QueueStatus } from "@/lib/client/types";
import type { Route } from "@/lib/types";
import type { DeskRow } from "@/lib/client/queue";
import { itemsText, ORDER_STATUS_LABEL } from "./model";

const APPOINTMENT_KIND: Record<string, string> = {
  initial: "First consult",
  follow_up: "Follow-up",
  renewal: "Script renewal",
};
const PLAN_STATUS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

/**
 * The patient's context: who and where they are, their local time and phone, and the replies this escalation holds
 * back. Their email, plan, recent orders, upcoming consults and other messages fold under "More about", one click away.
 */
export function ContextCard({
  data,
  rowsById,
  heldBack,
  hideIds,
  className,
}: {
  data: CaseFile;
  /** Live desk rows (this session applied), keyed by message id. */
  rowsById: Map<string, DeskRow>;
  /** Replies held back because of this message (check with the clinician first). */
  heldBack: DeskRow[];
  /** Messages listed elsewhere on the page (the withdrawn drafts in the bereavement card). */
  hideIds: Set<string>;
  className?: string;
}) {
  const { patient } = data;
  const plan = patient.plan;
  const recent = patient.orders.slice(0, 3);
  const booked = patient.appointments.filter((a) => a.status === "booked");
  const heldIds = new Set(heldBack.map((r) => r.messageId));
  const others = data.siblings.filter((s) => !s.testOnly && !hideIds.has(s.messageId) && !heldIds.has(s.messageId));
  const localTime = `${formatDate(DEMO_NOW, patient.timezone, "time")} ${zoneAbbr(DEMO_NOW, patient.timezone)}`;

  return (
    <Card as="section" aria-labelledby="context-title" className={className}>
      <CardHeader
        title={
          <span id="context-title">
            {patient.firstName} {patient.lastName}
          </span>
        }
        description={<span className="tnum">Patient {patient.id}</span>}
      />

      <ul className="flex flex-col gap-1.5 text-sm text-ink">
        <li className="flex items-start gap-2">
          <MapPin aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
          <span>
            {patient.suburb}, {patient.region}, {COUNTRY_LABEL[patient.country]}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Clock aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
          <span>
            It is <span className="font-medium text-heading tnum">{localTime}</span> for them now
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Phone aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
          <span className="tnum">{patient.phone}</span>
        </li>
      </ul>

      {heldBack.length > 0 && (
        <>
          <Divider />
          <h3 className="text-sm font-semibold text-heading">Held back until you have been in touch</h3>
          <p className="mt-0.5 text-xs text-muted">The desk cannot send these while this message is open.</p>
          <MessageList
            items={heldBack.map((r) => siblingFor(data, r))}
            rowsById={rowsById}
            timezone={patient.timezone}
            held
          />
        </>
      )}

      <Disclosure summary={`More about ${patient.firstName}`} className="mt-4 border-t border-line-cool pt-3">
        <ul className="flex flex-col gap-1.5 text-sm text-ink">
          <li className="flex min-w-0 items-start gap-2">
            <Mail aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
            <span className="min-w-0 break-all">{patient.email}</span>
          </li>
        </ul>

        <Divider />

        <h3 className="text-sm font-semibold text-heading">Plan</h3>
        <p className="mt-1 text-sm text-ink">
          {plan.name}, <span className="tnum">{formatMoney(plan.monthlyPrice, plan.currency, { explicit: true })}</span> a
          month
          {plan.concession ? " (concession)" : ""}
        </p>
        <p className="mt-0.5 text-sm text-muted">
          {PLAN_STATUS[plan.status] ?? plan.status}
          {plan.nextBillingDate && plan.status === "active" ? (
            <>
              , next billing <span className="tnum">{formatCalendarDate(plan.nextBillingDate)}</span>
            </>
          ) : null}
          , since <span className="tnum">{formatCalendarDate(plan.startedAt)}</span>
        </p>

        <Divider />

        <h3 className="text-sm font-semibold text-heading">Recent orders</h3>
        {recent.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {recent.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-heading tnum">{o.id}</span>
                  <span className="block text-xs text-muted">
                    {itemsText(o)}, placed{" "}
                    <span className="tnum">{formatDate(o.placedAt, patient.timezone, "dayShort")}</span>
                  </span>
                </span>
                <Chip tone={o.status === "on_hold" ? "hold" : o.status === "delivered" ? "success" : "neutral"}>
                  {ORDER_STATUS_LABEL[o.status]}
                </Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">No orders yet.</p>
        )}

        {booked.length > 0 && (
          <>
            <Divider />
            <h3 className="text-sm font-semibold text-heading">Booked consults</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {booked.map((a) => (
                <li key={a.id}>
                  <span className="font-medium text-heading">{APPOINTMENT_KIND[a.kind] ?? "Consult"}</span>{" "}
                  <span className="text-muted">
                    with {a.clinician}, <span className="tnum">{formatDate(a.at, patient.timezone, "dateTime")}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <Divider />
        <h3 className="text-sm font-semibold text-heading">Other messages from {patient.firstName}</h3>
        {others.length ? (
          <MessageList items={others} rowsById={rowsById} timezone={patient.timezone} />
        ) : (
          <p className="mt-1 text-sm text-muted">No other messages in the queue.</p>
        )}
      </Disclosure>
    </Card>
  );
}

function StatusBadge({ status, label, route }: { status?: QueueStatus; label?: string; route: Route }) {
  switch (status) {
    case "withdrawn":
      return <Chip tone="urgent">Withdrawn</Chip>;
    case "check_first":
      return <Chip tone="hold">Check with clinician</Chip>;
    case "ready":
      return <RiskBadge kind="ready" />;
    case "needs_person":
      return <RiskBadge kind="person" />;
    case "clinician":
      return <RiskBadge kind="clinician" />;
    case "urgent":
      return <RiskBadge kind="urgent" />;
    default:
      return <RiskBadge kind={ROUTE_TO_RISK[route]} label={label} />;
  }
}

function siblingFor(data: CaseFile, row: DeskRow): CaseSibling {
  return (
    data.siblings.find((s) => s.messageId === row.messageId) ?? {
      messageId: row.messageId,
      receivedAt: row.receivedAt,
      channel: row.channel,
      subject: row.subject,
      preview: row.preview,
      route: row.route,
      status: row.status,
      statusLabel: row.statusLabel,
      testOnly: false,
    }
  );
}

function MessageList({
  items,
  rowsById,
  timezone,
  held,
}: {
  items: CaseSibling[];
  rowsById: Map<string, DeskRow>;
  timezone: string;
  held?: boolean;
}) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {items.map((s) => {
        const live = rowsById.get(s.messageId);
        const inClinician = live?.inClinicianQueue ?? (s.route === "clinician" || s.route === "urgent");
        const href = inClinician ? `/clinician/?m=${s.messageId}` : `/desk/?m=${s.messageId}`;
        const replied = live?.replied;
        return (
          <li key={s.messageId}>
            <Link
              href={href}
              className={cn(
                "-mx-2 flex items-start justify-between gap-3 rounded-inner px-2 py-2 transition-colors duration-150",
                "hover:bg-field active:bg-field-hover",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-heading">{s.subject ?? s.preview}</span>
                <span className="block text-xs text-muted tnum">
                  {s.messageId}, {formatDate(s.receivedAt, timezone, "dayShort")},{" "}
                  {inClinician ? "clinician queue" : "desk"}
                </span>
              </span>
              {replied ? (
                <Chip tone="success">Replied</Chip>
              ) : held ? (
                <Chip tone="hold">Waiting for you</Chip>
              ) : (
                <StatusBadge
                  status={live?.status ?? s.status}
                  label={live?.statusLabel ?? s.statusLabel}
                  route={s.route}
                />
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
