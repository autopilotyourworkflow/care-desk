"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";
import type { IconType } from "./Button";

export interface DisclosureProps {
  /** The button text, e.g. "See what the AI saw". */
  summary: ReactNode;
  icon?: IconType;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled mode. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "inline" | "row";
  className?: string;
}

/**
 * Progressive disclosure: a button with aria-expanded that reveals content inline, animated with the grid-rows
 * technique. "inline" is a compact text button; "row" is a full-width row with a line under it.
 */
export function Disclosure({
  summary,
  icon: Icon,
  children,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  variant = "inline",
  className,
}: DisclosureProps) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const id = useId();
  const toggle = () => {
    const next = !open;
    if (controlled == null) setOwn(next);
    onOpenChange?.(next);
  };
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className={cn(
          "group inline-flex items-center gap-1.5 font-medium text-heading transition-colors duration-150",
          variant === "inline"
            ? "-mx-1.5 rounded-inner px-1.5 py-1 text-sm hover:bg-navy-900/[0.06] active:bg-navy-900/10"
            : "w-full justify-between border-b border-line-cool py-3 text-left text-sm hover:text-navy-700",
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          {Icon && <Icon aria-hidden size={16} className="text-muted-icon group-hover:text-heading" />}
          {summary}
        </span>
        <ChevronDown
          aria-hidden
          size={16}
          className={cn("shrink-0 text-muted-icon transition-transform duration-200 ease-out-expo", open && "rotate-180")}
        />
      </button>
      <div id={id} className="collapsible" data-open={open} inert={!open}>
        <div>
          <div className="pt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
