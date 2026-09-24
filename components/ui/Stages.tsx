"use client";

import { forwardRef, type ReactNode } from "react";
import { ChevronDown, ChevronUp, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { Button, IconButton, type IconType } from "./Button";
import { Tooltip } from "./Tooltip";
import { cn } from "./cn";

/**
 * The work screens open in three steps, so there is only ever one new thing to look at: the list alone, then the item
 * picked from it, then (on request) the details beside it. These are the pieces that invite each next step.
 */

export interface PickPromptProps {
  /** The main picture: what opens here. */
  icon: IconType;
  /** A small badge on the picture's corner, for the state the item arrives in (a checked reply, say). */
  badge?: { icon: IconType; className: string };
  title: string;
  children: ReactNode;
  /** One button that opens a good first item, so the next step is also one click. */
  action?: ReactNode;
  className?: string;
}

/**
 * What the empty work area says before anything is open: that the item opens here, what it arrives with, and a
 * button for a good first one. Everything else stays out of view until then, so the list leads.
 */
export function PickPrompt({ icon: Icon, badge, title, children, action, className }: PickPromptProps) {
  const Badge = badge?.icon;
  return (
    <div className={cn("flex min-h-full items-center justify-center px-6 py-12", className)}>
      <div className="flex max-w-[24rem] animate-rise-in flex-col items-center text-center">
        <span aria-hidden className="relative inline-flex">
          <span className="flex size-16 items-center justify-center rounded-[1.25rem] bg-surface text-navy-900 shadow-raised ring-1 ring-navy-900/[0.06]">
            <Icon size={28} strokeWidth={1.75} />
          </span>
          {Badge && (
            <span
              className={cn(
                "absolute -bottom-1.5 -right-1.5 flex size-7 items-center justify-center rounded-pill ring-4 ring-canvas",
                badge.className,
              )}
            >
              <Badge size={15} strokeWidth={2.25} />
            </span>
          )}
        </span>
        <h2 className="mt-6 text-xl font-semibold leading-snug text-heading text-balance">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">{children}</p>
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}

export interface DetailsControl {
  open: boolean;
  onToggle: () => void;
  /** The id of the details region the button shows and hides. */
  controls: string;
  /** "side": the details open as a column to the right. "inline": they open further down the page. */
  layout: "side" | "inline";
  /** What the details hold, in a few words, shown on hover and focus. */
  hint?: string;
}

/** The one control for the details: Show details, then Hide details. */
export const DetailsToggle = forwardRef<HTMLButtonElement, DetailsControl & { className?: string }>(
  function DetailsToggle({ open, onToggle, controls, layout, hint, className }, ref) {
    const icon: IconType = layout === "side" ? (open ? PanelRightClose : PanelRightOpen) : open ? ChevronUp : ChevronDown;
    const button = (
      <Button
        ref={ref}
        size="sm"
        variant={open ? "ghost" : "secondary"}
        leadingIcon={icon}
        aria-expanded={open}
        aria-controls={open ? controls : undefined}
        onClick={onToggle}
        data-details-toggle=""
        className={className}
      >
        {open ? "Hide details" : "Show details"}
      </Button>
    );
    // The tooltip stays in both states, so the button is never remounted and keeps focus when it is pressed.
    return hint ? <Tooltip content={hint}>{button}</Tooltip> : button;
  },
);

/** The top of the details: its name, and a close button that puts focus back on Show details. */
export function DetailsHeader({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2 pl-1">
      <p id={id} className="text-sm font-semibold text-heading">
        Details
      </p>
      <IconButton icon={X} label="Hide details" size="sm" onClick={onClose} className="-mr-1 text-muted-icon hover:text-heading" />
    </div>
  );
}
