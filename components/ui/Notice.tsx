import type { ReactNode } from "react";
import { CircleCheck, CirclePause, Info, OctagonAlert, Stethoscope, TriangleAlert } from "lucide-react";
import { cn } from "./cn";
import type { IconType } from "./Button";

export type NoticeTone = "info" | "success" | "warning" | "error" | "hold" | "clinician" | "neutral";

const NOTICE: Record<NoticeTone, { box: string; icon: IconType; iconClass: string; title: string }> = {
  info: { box: "bg-info-bg", icon: Info, iconClass: "text-info-fg", title: "text-info-fg" },
  success: { box: "bg-success-bg", icon: CircleCheck, iconClass: "text-success-fg", title: "text-success-fg" },
  warning: { box: "bg-warning-bg", icon: TriangleAlert, iconClass: "text-warning-fg", title: "text-warning-fg" },
  error: { box: "bg-error-bg", icon: OctagonAlert, iconClass: "text-error-fg", title: "text-error-fg" },
  hold: { box: "bg-hold-bg", icon: CirclePause, iconClass: "text-hold-icon", title: "text-hold-fg" },
  clinician: { box: "bg-clinician-bg", icon: Stethoscope, iconClass: "text-clinician-fg", title: "text-clinician-fg" },
  neutral: { box: "bg-field", icon: Info, iconClass: "text-navy-900", title: "text-heading" },
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: IconType;
  actions?: ReactNode;
  /** "alert" only for errors that appear after an action; "status" for live updates. */
  role?: "status" | "alert" | "note";
  className?: string;
}

/** An inline message in the flow: simulated-data labels, rate limits, AI resting mode, failures with a recovery. */
export function Notice({ tone = "info", title, children, icon, actions, role = "note", className }: NoticeProps) {
  const n = NOTICE[tone];
  const Icon = icon ?? n.icon;
  return (
    <div
      role={role === "note" ? undefined : role}
      className={cn("flex gap-3 rounded-control p-3.5 text-sm", n.box, className)}
    >
      <Icon aria-hidden size={18} className={cn("mt-0.5 shrink-0", n.iconClass)} />
      <div className="min-w-0 flex-1">
        {title && <p className={cn("font-semibold", n.title)}>{title}</p>}
        {children && <div className={cn("text-ink", title ? "mt-0.5" : undefined)}>{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
