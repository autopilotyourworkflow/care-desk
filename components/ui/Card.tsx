import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  padding?: "none" | "sm" | "md" | "lg";
  /** Lifted shadow for a focal card. Default is the soft card shadow. */
  raised?: boolean;
  /** Selected state, e.g. the open ticket. */
  selected?: boolean;
}

const pad = { none: "", sm: "p-4", md: "p-4 sm:p-6", lg: "p-5 sm:p-8" } as const;

/** The 24px white card. Never nest a Card inside a Card: use Inset for blocks inside a card. */
export function Card({ as: As = "div", padding = "md", raised, selected, className, children, ...rest }: CardProps) {
  return (
    <As
      className={cn(
        "min-w-0 rounded-card bg-surface",
        raised ? "shadow-raised" : "shadow-card",
        selected ? "ring-2 ring-navy-900" : "ring-1 ring-line/70",
        pad[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}

/** Heading row for a card: title (Poppins, not display), optional description and actions on the right. */
export function CardHeader({
  title,
  description,
  actions,
  as: As = "h2",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h2" | "h3" | "h4";
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <As className="text-base font-semibold text-heading">{title}</As>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A quiet block inside a card for evidence, quotes and source text. Not a card. */
export function Inset({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-inner bg-inset p-3 text-sm", className)} {...rest}>
      {children}
    </div>
  );
}

/** A thin rule inside cards. */
export function Divider({ className }: { className?: string }) {
  return <hr className={cn("my-4 border-0 border-t border-line-cool", className)} />;
}
