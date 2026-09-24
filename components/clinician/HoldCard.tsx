"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, CirclePause, CirclePlay, Info, Lock, PackageCheck, Truck } from "lucide-react";
import { Button, Card, CardHeader, Chip, Field, Inset, Notice, TextArea, useToast } from "@/components/ui";
import { formatCalendarDate, formatDate, plural, relativeTime } from "@/lib/format";
import { staffName, useSession } from "@/lib/client/session";
import type { CaseFile } from "@/lib/client/types";
import type { DeskRow } from "@/lib/client/queue";
import {
  escalatedAt,
  heldOrders,
  inTransitOrders,
  itemsText,
  ORDER_STATUS_LABEL,
  sessionNow,
  undeliveredOrders,
  type DeathFraming,
} from "./model";
import { useClinicianUndo } from "./undo";

type Stage = "idle" | "note" | "confirm";

/** What the hold covers, and resuming it: a written note, then a confirmation, recorded with the clinician's name. */
export function HoldCard({
  row,
  data,
  death,
  className,
}: {
  row: DeskRow;
  data: CaseFile;
  /** How a possible death is framed: resuming is locked only when the death leads. */
  death: DeathFraming;
  className?: string;
}) {
  const session = useSession();
  const { toast } = useToast();
  const undoable = useClinicianUndo();
  const [stage, setStage] = useState<Stage>("idle");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (stage === "note") noteRef.current?.focus();
    if (stage === "confirm") confirmRef.current?.focus();
  }, [stage]);

  const { patient } = data;
  const orders = heldOrders(patient.orders);
  const onTheWay = inTransitOrders(patient.orders);
  const resumed = row.clinicianRecord?.holdResumed;
  const blocked = death.led && !row.cleared;
  const checkDeath = death.mentioned && !death.led && !row.cleared;
  const nextBilling = patient.plan.status === "active" ? patient.plan.nextBillingDate : undefined;

  if (!row.holdOrders) {
    return (
      <Card as="section" aria-labelledby="hold-title" data-tour="clinician-hold" className={className}>
        <CardHeader
          title={<span id="hold-title">Orders</span>}
          actions={
            <Chip tone="success" icon={PackageCheck}>
              Not on hold
            </Chip>
          }
        />
        <p className="text-sm text-ink">
          This escalation does not stop {patient.firstName}&apos;s orders. Clinical questions and side effects wait for
          your reply, and orders carry on as normal.
        </p>
        {undeliveredOrders(patient.orders).length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {undeliveredOrders(patient.orders).map((o) => (
              <li key={o.id}>
                <OrderLine order={o} timezone={patient.timezone} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  const count = orders.length;
  const what = count ? plural(count, "order") : "future orders";

  /** Leave the note or the confirmation, and put focus back on the button that opened it. */
  const cancel = () => {
    setStage("idle");
    setError(null);
    window.setTimeout(() => resumeRef.current?.focus(), 0);
  };

  const continueToConfirm = () => {
    if (!note.trim()) {
      setError("Write a note before resuming, so the next person knows why it is safe.");
      noteRef.current?.focus();
      return;
    }
    setError(null);
    setStage("confirm");
  };

  const confirm = () => {
    const ok = session.resumeHold(row.messageId, note);
    if (!ok) {
      setError("That did not save. Check the note and try again.");
      setStage("note");
      return;
    }
    setStage("idle");
    setNote("");
    toast({
      message: "Orders resumed",
      detail: `${patient.firstName}, recorded as ${session.staff.name}`,
      tone: "success",
      onUndo: undoable("resumeHold", row.messageId),
    });
    // The resume button is gone once orders are resumed, so focus lands on the card title and its new state.
    window.setTimeout(() => (resumeRef.current ?? titleRef.current)?.focus(), 0);
  };

  const heldBy = row.reason.stoppedAt === "rules" ? "The safety rules held" : "The safety check held";

  return (
    <Card as="section" aria-labelledby="hold-title" data-tour="clinician-hold" className={className}>
      <CardHeader
        title={
          <span id="hold-title" ref={titleRef} tabIndex={-1} className="outline-none">
            Orders on hold
          </span>
        }
        actions={
          resumed ? (
            <Chip tone="success" icon={CircleCheck}>
              Resumed
            </Chip>
          ) : (
            <span className="text-xs text-muted tnum">
              Since {formatDate(escalatedAt(row), patient.timezone, "dayShort")}
            </span>
          )
        }
      />

      {resumed ? (
        <Notice tone="success" title={`Resumed by ${staffName(resumed.by) ?? "a clinician"}`} role="status">
          <p className="text-xs text-muted">{relativeTime(resumed.at, sessionNow())}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{resumed.note}</p>
        </Notice>
      ) : (
        <p className="text-sm text-ink">
          {heldBy} {count ? `every order for ${patient.firstName} not yet shipped` : `${patient.firstName}'s orders`}{" "}
          the moment this message arrived{count ? ". Nothing ships until a clinician resumes them." : "."}
        </p>
      )}

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-heading">{resumed ? "Released" : "What is held"}</h3>
        {count > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {orders.map((o) => (
              <li key={o.id}>
                <OrderLine order={o} timezone={patient.timezone} held={!resumed} />
              </li>
            ))}
          </ul>
        ) : onTheWay.length > 0 && !resumed ? (
          <p className="mt-1 text-sm text-muted">Nothing is waiting to be dispensed or shipped.</p>
        ) : nextBilling && !resumed ? (
          <>
            <p className="mt-1 text-sm text-ink">
              <span className="font-medium text-heading">
                Next order (due <span className="tnum">{formatCalendarDate(nextBilling)}</span>)
              </span>{" "}
              will not ship until a clinician resumes it.
            </p>
            <p className="mt-1 text-sm text-muted">Nothing is waiting to ship today.</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">No orders are waiting to ship right now.</p>
        )}
        {nextBilling && (count > 0 || resumed || onTheWay.length > 0) && (
          <p className="mt-2 text-sm text-muted">
            {resumed ? "The next order is due " : "The hold also covers the next order, due "}
            <span className="font-medium text-heading tnum">{formatCalendarDate(nextBilling)}</span>.
          </p>
        )}
      </div>

      {onTheWay.length > 0 && !resumed && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-heading">Already on its way</h3>
          <p className="mt-1 text-sm text-ink">
            The hold cannot stop {onTheWay.length === 1 ? "this parcel" : "these parcels"}: {onTheWay.length === 1 ? "it is" : "they are"}{" "}
            already with the courier.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {onTheWay.map((o) => (
              <li key={o.id}>
                <InTransitLine order={o} timezone={patient.timezone} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!resumed && (
        <div className="mt-5 border-t border-line-cool pt-4">
          {blocked && stage === "idle" && (
            <p className="mb-3 flex items-start gap-2 text-sm text-ink">
              <Lock aria-hidden size={16} className="mt-0.5 shrink-0 text-hold-icon" />
              <span>
                The message may report a death, so resuming is locked. If it turns out to be about someone else, mark it
                as a false alarm first.
              </span>
            </p>
          )}

          {checkDeath && stage === "idle" && (
            <p className="mb-3 flex items-start gap-2 text-sm text-ink">
              <Info aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
              <span>
                The message also mentions a death. Resume only once you know {patient.firstName} is well and it is safe
                to continue.
              </span>
            </p>
          )}

          {stage === "idle" && (
            <Button
              ref={resumeRef}
              variant="secondary"
              leadingIcon={CirclePlay}
              disabled={blocked}
              onClick={() => setStage("note")}
              fullWidth
            >
              Resume orders
            </Button>
          )}

          {stage === "note" && (
            <div className="flex flex-col gap-3">
              <Field
                label="Why is it safe to resume?"
                required
                hint="Saved with your name. The next person to open this sees it."
                error={error}
              >
                <TextArea
                  ref={noteRef}
                  rows={3}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      continueToConfirm();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancel();
                    }
                  }}
                  placeholder="For example: spoke to the patient, symptoms settled, safe to continue"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={continueToConfirm}>Continue</Button>
                <Button variant="ghost" onClick={cancel}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {stage === "confirm" && (
            <div
              ref={confirmRef}
              tabIndex={-1}
              role="group"
              aria-labelledby="resume-confirm-title"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setStage("note");
                }
              }}
              className="flex flex-col gap-3 outline-none"
            >
              <p id="resume-confirm-title" className="text-sm font-semibold text-heading">
                Resume {what} for {patient.firstName}?
              </p>
              <Inset>
                <p className="text-xs text-muted">Your note</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-ink">{note.trim()}</p>
              </Inset>
              <p className="text-sm text-muted">
                {count
                  ? `${orders.map((o) => o.id).join(", ")} can be dispensed and shipped again.`
                  : "New orders can be dispensed and shipped again."}{" "}
                Recorded as {session.staff.name}.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button leadingIcon={CirclePlay} onClick={confirm}>
                  Yes, resume orders
                </Button>
                <Button variant="ghost" onClick={() => setStage("note")}>
                  Go back
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function OrderLine({
  order,
  timezone,
  held,
}: {
  order: CaseFile["patient"]["orders"][number];
  timezone: string;
  held?: boolean;
}) {
  const when =
    order.status === "shipped" && order.eta
      ? `shipped ${formatDate(order.shippedAt ?? order.placedAt, timezone, "dayShort")}, due ${formatCalendarDate(order.eta, { noYear: true })}`
      : order.status === "delivered" && order.deliveredAt
        ? `delivered ${formatDate(order.deliveredAt, timezone, "dayShort")}`
        : `placed ${formatDate(order.placedAt, timezone, "dayShort")}`;
  return (
    <Inset className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-heading tnum">{order.id}</span>
        <span className="block text-xs text-muted">
          {itemsText(order)}, <span className="tnum">{when}</span>
          {order.holdReason ? `. ${order.holdReason}` : ""}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Chip tone="neutral">{ORDER_STATUS_LABEL[order.status]}</Chip>
        {held && (
          <Chip tone="hold" icon={CirclePause}>
            Held
          </Chip>
        )}
      </span>
    </Inset>
  );
}

/** A parcel the hold cannot stop: when it left, when it is due, and how to intercept it. */
function InTransitLine({ order, timezone }: { order: CaseFile["patient"]["orders"][number]; timezone: string }) {
  const due = order.eta ? formatCalendarDate(order.eta, { noYear: true }) : undefined;
  return (
    <Notice tone="warning" icon={Truck} title={<span className="tnum">{order.id}</span>}>
      <p>
        {itemsText(order)}. Already shipped
        {order.shippedAt ? <span className="tnum"> {formatDate(order.shippedAt, timezone, "dayShort")}</span> : null}
        {due ? (
          <>
            , due <span className="tnum">{due}</span>
          </>
        ) : null}
        .
      </p>
      <p className="mt-1">
        {order.carrier ? `${order.carrier}` : "The courier"}
        {order.tracking ? (
          <>
            , tracking <span className="tnum">{order.tracking}</span>
          </>
        ) : null}
        . Contact the courier to intercept it if needed.
      </p>
    </Notice>
  );
}
