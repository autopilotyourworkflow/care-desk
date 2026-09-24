import type { Route } from "@/lib/types";
import { Ban, CircleCheck, CirclePause, ShieldAlert, Siren, Stethoscope, UserRound } from "lucide-react";
import { plural } from "@/lib/format";
import { cn } from "./cn";
import { TONE_CLASSES, type Tone } from "./Chip";
import type { IconType } from "./Button";

export type RiskKind = "ready" | "person" | "clinician" | "urgent";

export const RISK_META: Record<RiskKind, { label: string; icon: IconType; tone: Tone }> = {
  ready: { label: "Ready to send", icon: CircleCheck, tone: "success" },
  person: { label: "Write the reply", icon: UserRound, tone: "info" },
  clinician: { label: "Clinician", icon: Stethoscope, tone: "clinician" },
  urgent: { label: "Urgent", icon: Siren, tone: "urgent" },
};

export const ROUTE_TO_RISK: Record<Route, RiskKind> = {
  draft: "ready",
  person: "person",
  clinician: "clinician",
  urgent: "urgent",
};

export interface RiskBadgeProps {
  /** Either the badge kind or a pipeline route (draft maps to "Ready to send"). */
  kind?: RiskKind;
  route?: Route;
  size?: "sm" | "md";
  /** Override the text, keeping icon and tone. */
  label?: string;
  className?: string;
}

/** Where a message stands: always icon plus words, never colour alone. */
export function RiskBadge({ kind, route, size = "sm", label, className }: RiskBadgeProps) {
  const k = kind ?? (route ? ROUTE_TO_RISK[route] : "person");
  const { label: text, icon: Icon, tone } = RISK_META[k];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-pill font-semibold",
        size === "sm" ? "h-6 pl-2 pr-2.5 text-xs" : "h-7 pl-2.5 pr-3 text-sm",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon aria-hidden size={size === "sm" ? 13 : 15} className="shrink-0" />
      {label ?? text}
    </span>
  );
}

/** "Orders on hold", or "2 orders on hold" with a count. */
export function HoldBadge({ count, size = "sm", className }: { count?: number; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-pill font-semibold",
        size === "sm" ? "h-6 pl-2 pr-2.5 text-xs" : "h-7 pl-2.5 pr-3 text-sm",
        TONE_CLASSES.hold,
        className,
      )}
    >
      <CirclePause aria-hidden size={size === "sm" ? 13 : 15} className="shrink-0 text-hold-icon" />
      {count == null ? "Orders on hold" : `${plural(count, "order")} on hold`}
    </span>
  );
}

/** Patient-level locks from the desk queue, with the same words, icons and tones as the desk's status badges. */
export const LOCK_META: Record<"withdrawn" | "check_clinician", { label: string; icon: IconType; tone: Tone }> = {
  check_clinician: { label: "Held: clinician first", icon: ShieldAlert, tone: "warning" },
  withdrawn: { label: "Withdrawn", icon: Ban, tone: "neutral" },
};

/** "Held: clinician first" or "Withdrawn": icon plus words, the same shape as RiskBadge. */
export function LockBadge({
  kind,
  size = "sm",
  className,
}: {
  kind: "withdrawn" | "check_clinician";
  size?: "sm" | "md";
  className?: string;
}) {
  const { label, icon: Icon, tone } = LOCK_META[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-pill font-semibold",
        size === "sm" ? "h-6 pl-2 pr-2.5 text-xs" : "h-7 pl-2.5 pr-3 text-sm",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon aria-hidden size={size === "sm" ? 13 : 15} className="shrink-0" />
      {label}
    </span>
  );
}
