import type { ReactNode } from "react";
import type { Category } from "@/lib/types";
import { categoryLabel } from "@/lib/format";
import { cn } from "./cn";
import type { IconType } from "./Button";

export type Tone = "neutral" | "info" | "success" | "clinician" | "urgent" | "hold" | "warning" | "navy" | "outline";

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-field text-heading",
  info: "bg-info-bg text-info-fg",
  success: "bg-success-bg text-success-fg",
  clinician: "bg-clinician-bg text-clinician-fg",
  urgent: "bg-urgent-bg text-urgent-fg",
  hold: "bg-hold-bg text-hold-fg",
  warning: "bg-warning-bg text-warning-fg",
  navy: "bg-navy-900 text-white",
  outline: "border border-line-strong bg-surface text-heading",
};

/** Tone for a message category: safety categories carry their route's colour, routine ones stay neutral. */
export function categoryTone(category: Category | "stop_sending"): Tone {
  switch (category) {
    case "clinical_question":
    case "side_effect":
      return "clinician";
    case "adverse_event":
    case "crisis":
    case "bereavement":
      return "urgent";
    case "stop_sending":
      return "hold";
    default:
      return "neutral";
  }
}

export interface ChipProps {
  /** A message category, rendered in plain words ("Order status", "Clinical question"). */
  category?: Category | "stop_sending";
  tone?: Tone;
  icon?: IconType;
  size?: "sm" | "md";
  className?: string;
  children?: ReactNode;
}

/** A pill tag for categories and short labels. Not interactive: use SegmentedControl for filters. */
export function Chip({ category, tone, icon: Icon, size = "sm", className, children }: ChipProps) {
  const t = tone ?? (category ? categoryTone(category) : "neutral");
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-pill font-medium",
        size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-sm",
        TONE_CLASSES[t],
        className,
      )}
    >
      {Icon && <Icon aria-hidden size={size === "sm" ? 12 : 14} className="shrink-0" />}
      <span className="truncate">{children ?? (category ? categoryLabel(category) : null)}</span>
    </span>
  );
}
