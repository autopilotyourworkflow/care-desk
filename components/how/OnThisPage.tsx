"use client";

import { useEffect, useState } from "react";
import { cn } from "@/components/ui/cn";

export interface TocItem {
  id: string;
  label: string;
  /** A folded reference part inside a section. Listed indented in the rail, left out of the phone pills. */
  sub?: boolean;
}

/**
 * "On this page": a sticky list of the sections from 1280px, and a wrapping row of pill links below that. The link
 * for the section being read is marked with aria-current, found with an IntersectionObserver. `onNavigate` lets the
 * page open a folded part before the browser jumps to it.
 */
export function OnThisPage({
  items,
  variant,
  onNavigate,
}: {
  items: TocItem[];
  variant: "rail" | "pills";
  onNavigate?: (id: string) => void;
}) {
  const [active, setActive] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    if (variant !== "rail" || typeof IntersectionObserver === "undefined") return;
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        // A folded part sits inside its section, so prefer it when both are in view.
        const first = items.find((i) => i.sub && visible.has(i.id)) ?? items.find((i) => visible.has(i.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-80px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items, variant]);

  if (variant === "pills") {
    return (
      <nav aria-label="On this page" className="xl:hidden">
        <ul className="flex flex-wrap gap-2">
          {items
            .filter((i) => !i.sub)
            .map((i) => (
              <li key={i.id}>
                <a
                  href={`#${i.id}`}
                  onClick={() => onNavigate?.(i.id)}
                  className="inline-flex h-8 items-center rounded-pill bg-surface px-3 text-xs font-medium text-heading ring-1 ring-line transition-colors duration-150 hover:bg-field active:bg-field-hover"
                >
                  {i.label}
                </a>
              </li>
            ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="On this page" className="sticky top-24 hidden xl:block">
      <p className="mb-2 px-3 text-xs font-semibold text-muted">On this page</p>
      <ul className="space-y-0.5">
        {items.map((i) => {
          const on = i.id === active;
          return (
            <li key={i.id}>
              <a
                href={`#${i.id}`}
                aria-current={on ? "true" : undefined}
                onClick={() => {
                  setActive(i.id);
                  onNavigate?.(i.id);
                }}
                className={cn(
                  "block rounded-inner py-1.5 text-sm transition-colors duration-150",
                  i.sub ? "pl-6 pr-3 text-[0.8125rem]" : "px-3",
                  on
                    ? "bg-field font-medium text-heading"
                    : "text-muted hover:bg-navy-900/[0.04] hover:text-heading active:bg-navy-900/[0.08]",
                )}
              >
                {i.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
