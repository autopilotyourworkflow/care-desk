"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";
import type { IconType } from "./Button";

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  /** Count shown in a small pill, e.g. queue sizes. */
  count?: number;
  icon?: IconType;
  disabled?: boolean;
}

function moveFocus<T extends string>(
  e: KeyboardEvent<HTMLElement>,
  items: TabItem<T>[],
  current: T,
  onChange: (id: T) => void,
  refs: Map<T, HTMLButtonElement | null>,
  orientation: "horizontal" | "vertical" = "horizontal",
) {
  const enabled = items.filter((i) => !i.disabled);
  const idx = enabled.findIndex((i) => i.id === current);
  const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const prev = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  let target: TabItem<T> | undefined;
  if (e.key === next) target = enabled[(idx + 1) % enabled.length];
  else if (e.key === prev) target = enabled[(idx - 1 + enabled.length) % enabled.length];
  else if (e.key === "Home") target = enabled[0];
  else if (e.key === "End") target = enabled[enabled.length - 1];
  if (!target) return;
  e.preventDefault();
  onChange(target.id);
  refs.get(target.id)?.focus();
}

export const tabId = (base: string, id: string) => `${base}-tab-${id}`;
export const panelId = (base: string, id: string) => `${base}-panel-${id}`;

export interface TabsProps<T extends string> {
  /** Unique base id, used to link each tab to its TabPanel. */
  id: string;
  /** Accessible name for the tab list. */
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  /** Stretch tabs to fill the width (mobile). */
  fill?: boolean;
}

/**
 * True while a horizontally scrolling element has more content past its right edge. Drives the edge fade that shows
 * there are more tabs to scroll to.
 */
function useMoreToTheRight<E extends HTMLElement>() {
  const ref = useRef<E>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);
  return [ref, more] as const;
}

/** Tabs with automatic activation, arrow keys, Home and End. Pair each tab with a <TabPanel>. */
export function Tabs<T extends string>({ id, label, items, value, onChange, className, fill }: TabsProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());
  const [listRef, more] = useMoreToTheRight<HTMLDivElement>();
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      data-overflow={more || undefined}
      className={cn(
        // pb-px: overflow clips at the padding edge, so the tabs' -mb-px row (their underline and focus ring) needs room.
        "flex gap-1 overflow-x-auto border-b border-line-cool pb-px [scrollbar-width:none]",
        "data-[overflow]:[mask-image:linear-gradient(90deg,#000_80%,transparent)]",
        className,
      )}
      onKeyDown={(e) => moveFocus(e, items, value, onChange, refs.current)}
    >
      {items.map((item) => {
        const selected = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current.set(item.id, el);
            }}
            role="tab"
            type="button"
            id={tabId(id, item.id)}
            aria-selected={selected}
            aria-controls={panelId(id, item.id)}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative -mb-px inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-t-inner px-3 text-sm font-medium",
              "transition-colors duration-150 ease-out-expo",
              // The tablist scrolls sideways, which clips anything outside it: draw the focus ring inside the tab, and keep
              // the underline beneath the ring (isolate + a negative z-index) so all four sides show.
              "isolate focus-visible:outline-offset-[-2px]",
              "after:absolute after:inset-x-2 after:bottom-0 after:-z-10 after:h-0.5 after:rounded-pill after:transition-colors after:duration-150",
              selected
                ? "text-heading after:bg-navy-900"
                : "text-muted after:bg-transparent hover:text-heading hover:after:bg-line-strong",
              "disabled:cursor-not-allowed disabled:text-disabled-fg disabled:hover:after:bg-transparent",
              fill && "flex-1",
            )}
          >
            {Icon && <Icon aria-hidden size={16} />}
            {item.label}
            {item.count != null && (
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-pill px-1.5 text-2xs font-semibold tnum",
                  selected ? "bg-navy-900 text-white" : "bg-field text-heading",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  tabsId,
  id,
  value,
  children,
  className,
}: {
  tabsId: string;
  id: string;
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const active = id === value;
  return (
    <div
      role="tabpanel"
      id={panelId(tabsId, id)}
      aria-labelledby={tabId(tabsId, id)}
      hidden={!active}
      tabIndex={0}
      className={cn("focus-visible:outline-offset-4", className)}
    >
      {active ? children : null}
    </div>
  );
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
  className?: string;
  /** Visually hide the label (it stays available to screen readers). Default true. */
  hideLabel?: boolean;
  fill?: boolean;
}

/** A single-choice filter (radio group) on the input-fill track: queue filters, test-case filters, patient pickers. */
export function SegmentedControl<T extends string>({
  label,
  items,
  value,
  onChange,
  size = "md",
  className,
  hideLabel = true,
  fill,
}: SegmentedControlProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());
  return (
    <div className={cn("inline-flex flex-col gap-1.5", fill && "flex w-full", className)}>
      <span className={cn("text-xs font-medium text-muted", hideLabel && "sr-only")}>{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn("inline-flex gap-1 rounded-control bg-field p-1", fill && "flex w-full")}
        onKeyDown={(e) => moveFocus(e, items, value, onChange, refs.current)}
      >
        {items.map((item) => {
          const checked = item.id === value;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current.set(item.id, el);
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange(item.id)}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-inner font-medium",
                "transition-[background-color,color,box-shadow] duration-150 ease-out-expo",
                size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
                checked
                  ? "bg-surface text-heading shadow-[0_1px_2px_rgb(1_3_55/0.10),0_2px_8px_-2px_rgb(1_3_55/0.12)]"
                  : "text-muted hover:bg-white/60 hover:text-heading",
                "disabled:cursor-not-allowed disabled:text-disabled-fg disabled:hover:bg-transparent",
                fill && "flex-1",
              )}
            >
              {Icon && <Icon aria-hidden size={size === "sm" ? 13 : 15} />}
              {item.label}
              {item.count != null && (
                <span className={cn("text-2xs font-semibold tnum", checked ? "text-heading" : "text-muted")}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
