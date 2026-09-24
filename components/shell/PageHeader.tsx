import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Page title in Clash Display (the only other place display type is used), one short line under it, and actions.
 * No eyebrow or kicker above the title: the title carries itself. Keep the description to one sentence and `meta` to
 * one label at most (usually the page's single "Sample results" notice): the page itself carries the detail.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** One chip or notice beside the description, e.g. the page's "Sample results" note. */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mb-8", className)}>
      <div className="min-w-0 max-w-3xl">
        <h1 className="display-title text-balance text-2xl text-navy-900 sm:text-3xl">{title}</h1>
        {(description || meta) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            {description && <p className="max-w-[62ch] text-pretty text-base text-muted">{description}</p>}
            {meta && <div className="flex flex-wrap items-center gap-2">{meta}</div>}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
