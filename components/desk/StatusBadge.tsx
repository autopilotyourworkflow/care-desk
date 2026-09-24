import { Ban, CirclePause, CornerUpRight, Send, ShieldAlert, Stethoscope, UserRoundCheck } from "lucide-react";
import { QUEUE_STATUS_LABEL, type QueueStatus } from "@/lib/fixtures/queue";
import type { DeskRow } from "@/lib/client/queue";
import { staffName } from "@/lib/client/session";
import { cn } from "@/components/ui/cn";
import { RISK_META, TONE_CLASSES, type Tone } from "@/components/ui";
import type { IconType } from "@/components/ui";
import { firstNameOf } from "./desk-model";

interface BadgeMeta {
  label: string;
  icon: IconType;
  tone: Tone;
}

/** Queue statuses reuse the RiskBadge icons and tones where they overlap, so a status reads the same on every screen. */
export const STATUS_META: Record<QueueStatus, BadgeMeta> = {
  ready: { ...RISK_META.ready, label: QUEUE_STATUS_LABEL.ready },
  needs_person: { ...RISK_META.person, label: QUEUE_STATUS_LABEL.needs_person },
  clinician: { ...RISK_META.clinician, label: QUEUE_STATUS_LABEL.clinician },
  urgent: { ...RISK_META.urgent, label: QUEUE_STATUS_LABEL.urgent },
  check_first: { label: QUEUE_STATUS_LABEL.check_first, icon: ShieldAlert, tone: "warning" },
  withdrawn: { label: QUEUE_STATUS_LABEL.withdrawn, icon: Ban, tone: "neutral" },
};

/** What the row shows now: the pipeline status, or what happened to it in this session. */
export function rowBadge(row: DeskRow): BadgeMeta {
  const d = row.decision;
  if (d?.kind === "sent") return { label: "Sent", icon: Send, tone: "success" };
  if (d?.kind === "sent_edited") return { label: d.edit === "written" ? "Sent, written by you" : "Sent, edited", icon: Send, tone: "success" };
  if (d?.kind === "escalated") return { label: "Escalated", icon: CornerUpRight, tone: "clinician" };
  if (d?.kind === "reassigned") {
    const who = staffName(d.to);
    return { label: who ? `Passed to ${firstNameOf(who)}` : "Passed on", icon: UserRoundCheck, tone: "neutral" };
  }
  if (row.clinicianReplied) return { label: "Clinician replied", icon: Stethoscope, tone: "success" };
  // A check-with-clinician lock blocks the reply whatever the status, so the row says so before it is opened.
  if (row.lock?.kind === "check_clinician") return STATUS_META.check_first;
  return STATUS_META[row.status];
}

/** Icon plus words, never colour alone. Same shape as RiskBadge. */
export function StatusBadge({ meta, size = "sm", className }: { meta: BadgeMeta; size?: "sm" | "md"; className?: string }) {
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-pill font-semibold",
        size === "sm" ? "h-6 pl-2 pr-2.5 text-xs" : "h-7 pl-2.5 pr-3 text-sm",
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      <Icon aria-hidden size={size === "sm" ? 13 : 15} className="shrink-0" />
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

/**
 * The queue rows' short hold marker ("On hold"), shared by the desk and clinician queues. The open message and the hold
 * card say "Orders on hold" in full; in a list the short form keeps the row to one line of chips.
 */
export function HoldPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-pill pl-2 pr-2.5 text-xs font-semibold",
        TONE_CLASSES.hold,
        className,
      )}
    >
      <CirclePause aria-hidden size={13} className="shrink-0 text-hold-icon" />
      On hold<span className="sr-only">: orders are on hold</span>
    </span>
  );
}
