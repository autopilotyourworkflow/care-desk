import type { ReactNode } from "react";
import { cn } from "./cn";
import type { IconType } from "./Button";

export interface EmptyStateProps {
  icon?: IconType;
  title: string;
  /** Teach the interface: what normally appears here and how to get it. */
  children?: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

/** An empty region that explains itself: "All caught up" plus what happens next, never just "Nothing here". */
export function EmptyState({ icon: Icon, title, children, actions, size = "md", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col items-center text-center",
        size === "md" ? "px-6 py-12" : "px-4 py-8",
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            "mb-4 inline-flex items-center justify-center rounded-pill bg-field text-navy-900",
            size === "md" ? "size-12" : "size-10",
          )}
        >
          <Icon aria-hidden size={size === "md" ? 22 : 18} />
        </span>
      )}
      <h3 className={cn("font-semibold text-heading", size === "md" ? "text-base" : "text-sm")}>{title}</h3>
      {children && <div className="mt-1.5 text-sm text-muted">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
