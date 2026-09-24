"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";
import { placeMenu, type Align } from "./floating";
import type { IconType } from "./Button";

export type MenuEntry =
  | {
      type?: "item";
      id: string;
      label: string;
      description?: string;
      icon?: IconType;
      /** Right-aligned hint such as <Kbd>?</Kbd>. */
      hint?: ReactNode;
      href?: string;
      onSelect?: () => void;
      disabled?: boolean;
    }
  | {
      type: "radio";
      id: string;
      label: string;
      description?: string;
      icon?: IconType;
      checked: boolean;
      onSelect: () => void;
    }
  | { type: "separator"; id: string }
  | { type: "label"; id: string; label: string };

export interface MenuTriggerProps {
  ref: (el: HTMLButtonElement | null) => void;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string;
  open: boolean;
}

export interface MenuProps {
  /** Accessible name of the menu, e.g. "Viewing as". */
  label: string;
  /** Render the trigger button. Spread the props onto a <button>. */
  trigger: (props: MenuTriggerProps) => ReactNode;
  items: MenuEntry[];
  align?: Align;
  className?: string;
  /** Minimum width of the panel. */
  width?: number;
}

/**
 * Dropdown menu on the popover API: rendered in the top layer (never clipped), light-dismissed on outside click and
 * Escape. Arrow keys, Home and End move between items; focus returns to the trigger on close.
 */
export function Menu({ label, trigger, items, align = "start", className, width = 240 }: MenuProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const closedAt = useRef(-Infinity);

  const itemEls = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);

  const show = useCallback(
    (focus: "first" | "last" | "checked" = "checked") => {
      const panel = panelRef.current;
      const trig = triggerRef.current;
      if (!panel || !trig) return;
      try {
        panel.showPopover();
      } catch {
        return;
      }
      placeMenu(trig, panel, align);
      const els = itemEls();
      const checked = els.find((el) => el.getAttribute("aria-checked") === "true");
      const target = focus === "last" ? els[els.length - 1] : focus === "checked" ? (checked ?? els[0]) : els[0];
      target?.focus();
    },
    [align],
  );

  const hide = useCallback((returnFocus = true) => {
    const panel = panelRef.current;
    try {
      if (panel?.matches(":popover-open")) panel.hidePopover();
    } catch {
      /* already closed */
    }
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onToggle = (e: Event) => {
      const next = (e as ToggleEvent).newState === "open";
      setOpen(next);
      // Event timestamps share one clock (the page's time origin), so the click handler can compare against it.
      if (!next) closedAt.current = e.timeStamp;
    };
    panel.addEventListener("toggle", onToggle);
    const onResize = () => hide(false);
    window.addEventListener("resize", onResize);
    return () => {
      panel.removeEventListener("toggle", onToggle);
      window.removeEventListener("resize", onResize);
    };
  }, [hide]);

  const setTriggerRef = useCallback((el: HTMLButtonElement | null) => {
    triggerRef.current = el;
  }, []);

  const onTriggerClick = (e: MouseEvent<HTMLButtonElement>) => {
    // A click on the trigger while open light-dismisses first; do not reopen straight away.
    if (e.timeStamp - closedAt.current < 250) return;
    if (open) hide();
    else show("checked");
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      show("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      show("last");
    }
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = itemEls();
    const idx = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(idx + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(idx - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === "Tab") {
      hide(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
  };

  const itemClass = (disabled?: boolean) =>
    cn(
      "flex w-full items-start gap-3 rounded-inner px-3 py-2 text-left text-sm text-ink",
      "transition-colors duration-150",
      // Keyboard focus is a 2px ring inside the item (the pale fill alone is about 1.1:1 on white); hover keeps the fill.
      "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus focus-visible:outline-offset-[-2px]",
      disabled ? "cursor-not-allowed text-disabled-fg" : "hover:bg-field focus-visible:bg-field active:bg-field-hover",
    );

  return (
    <>
      <TriggerSlot
        render={trigger}
        buttonRef={setTriggerRef}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKey}
        controls={id}
        open={open}
      />
      <div
        ref={panelRef}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        onKeyDown={onPanelKey}
        style={{ minWidth: width }}
        className={cn(
          "overflow-y-auto rounded-control bg-surface p-1.5 shadow-pop ring-1 ring-line-cool",
          "open:animate-rise-in",
          className,
        )}
      >
        {items.map((it) => {
          if (it.type === "separator") return <div key={it.id} role="separator" className="my-1.5 h-px bg-line-cool" />;
          if (it.type === "label")
            return (
              <div key={it.id} role="presentation" className="px-3 pb-1 pt-2 text-xs font-medium text-muted">
                {it.label}
              </div>
            );
          const Icon = it.icon;
          const body = (
            <>
              {it.type === "radio" ? (
                <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
                  {it.checked && <Check aria-hidden size={16} className="text-navy-900" />}
                </span>
              ) : Icon ? (
                <Icon aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className={cn("block font-medium", it.type === "radio" && it.checked && "text-heading")}>
                  {it.label}
                </span>
                {it.description && <span className="block text-xs text-muted">{it.description}</span>}
              </span>
              {it.type !== "radio" && it.hint && <span className="mt-0.5 shrink-0">{it.hint}</span>}
            </>
          );
          if (it.type === "radio") {
            return (
              <button
                key={it.id}
                type="button"
                role="menuitemradio"
                aria-checked={it.checked}
                tabIndex={-1}
                className={itemClass()}
                onClick={() => {
                  hide();
                  it.onSelect();
                }}
              >
                {body}
              </button>
            );
          }
          if (it.href && !it.disabled) {
            return (
              <Link
                key={it.id}
                href={it.href}
                role="menuitem"
                tabIndex={-1}
                className={itemClass()}
                onClick={() => {
                  hide(false);
                  it.onSelect?.();
                }}
              >
                {body}
              </Link>
            );
          }
          return (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={it.disabled || undefined}
              className={itemClass(it.disabled)}
              onClick={() => {
                if (it.disabled) return;
                hide();
                it.onSelect?.();
              }}
            >
              {body}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * Calls the caller's trigger render prop. Kept as its own component so the menu hands its handlers over as JSX props
 * (the React compiler rightly refuses ref-touching callbacks passed to a plain function call during render).
 */
function TriggerSlot({
  render,
  buttonRef,
  onClick,
  onKeyDown,
  controls,
  open,
}: {
  render: MenuProps["trigger"];
  buttonRef: MenuTriggerProps["ref"];
  onClick: MenuTriggerProps["onClick"];
  onKeyDown: MenuTriggerProps["onKeyDown"];
  controls: string;
  open: boolean;
}) {
  return (
    <>
      {render({
        ref: buttonRef,
        onClick,
        onKeyDown,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": controls,
        open,
      })}
    </>
  );
}
