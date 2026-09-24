"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { placeTooltip, type Side } from "./floating";

interface TriggerProps {
  "aria-describedby"?: string;
  "aria-expanded"?: boolean;
  onClick?: (e: ReactMouseEvent<HTMLElement>) => void;
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<TriggerProps>;
  side?: Side;
  /** Hover delay in ms. Keyboard focus shows it at once. */
  delay?: number;
  /**
   * Link the tip to the trigger with aria-describedby. Turn off when the tip only repeats the accessible name
   * (icon buttons), so screen readers do not hear it twice. Ignored in toggle mode.
   */
  describe?: boolean;
  /**
   * Toggletip: a press (tap, click, Enter or Space) opens the text and keeps it open until the next press, Escape or a
   * press outside. The trigger must be a <button type="button">; it gets aria-expanded, and the text is announced
   * politely when it opens. Use this whenever the text matters on a phone, where there is no hover.
   */
  toggle?: boolean;
}

/** How long a hover tip stays open after the pointer leaves, so it can move onto the tip and read it. */
const HOVER_GRACE_MS = 150;

/**
 * A short hint on hover and keyboard focus, or with `toggle`, on press as well. Rendered with the popover API in the
 * top layer, so it is never clipped. Escape hides it. Never put essential information only in a hover tooltip: use
 * `toggle` for anything a touch user must be able to read.
 */
export function Tooltip({ content, children, side = "top", delay = 350, describe = true, toggle = false }: TooltipProps) {
  const id = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  /** A short grace period on pointer leave, so the pointer can cross the gap onto the tip (WCAG 1.4.13, hoverable). */
  const hideTimer = useRef<number | undefined>(undefined);
  /** Toggle mode: opened by a press, so hover and blur leave it alone. */
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  const show = useCallback(
    (immediate = false) => {
      window.clearTimeout(timer.current);
      const open = () => {
        const tip = tipRef.current;
        const anchor = (wrapRef.current?.firstElementChild as HTMLElement | null) ?? wrapRef.current;
        if (!tip || !anchor || !tip.isConnected) return;
        try {
          if (!tip.matches(":popover-open")) tip.showPopover();
        } catch {
          return;
        }
        placeTooltip(anchor, tip, side);
      };
      if (immediate) open();
      else timer.current = window.setTimeout(open, delay);
    },
    [delay, side],
  );

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    window.clearTimeout(hideTimer.current);
    const tip = tipRef.current;
    try {
      if (tip?.matches(":popover-open")) tip.hidePopover();
    } catch {
      /* already hidden */
    }
  }, []);

  const isOpen = () => {
    try {
      return Boolean(tipRef.current?.matches(":popover-open"));
    } catch {
      return false;
    }
  };
  const cancelHide = () => window.clearTimeout(hideTimer.current);
  /** Pointer left the trigger or the tip: close soon, unless it arrives on the other one first. */
  const leave = () => {
    if (pinnedRef.current) return;
    if (!isOpen()) {
      hide();
      return;
    }
    cancelHide();
    hideTimer.current = window.setTimeout(hide, HOVER_GRACE_MS);
  };

  const close = useCallback(() => {
    setPinned(false);
    hide();
  }, [hide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.clearTimeout(timer.current);
      window.clearTimeout(hideTimer.current);
    };
  }, [close]);

  // Toggle mode: show while pinned, and close on a press anywhere outside the trigger.
  useEffect(() => {
    if (!toggle) return;
    if (!pinned) {
      hide();
      return;
    }
    show(true);
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [toggle, pinned, show, hide]);

  let child: ReactNode = children;
  if (isValidElement(children)) {
    if (toggle) {
      const own = children.props.onClick;
      child = cloneElement(children, {
        "aria-expanded": pinned,
        onClick: (e: ReactMouseEvent<HTMLElement>) => {
          own?.(e);
          setPinned((p) => !p);
        },
      });
    } else if (describe) {
      child = cloneElement(children, { "aria-describedby": id });
    }
  }

  return (
    <span
      ref={wrapRef}
      className="inline-flex"
      onPointerEnter={(e) => {
        cancelHide();
        if (e.pointerType === "mouse" && !isOpen()) show();
      }}
      onPointerLeave={leave}
      onFocus={(e) => {
        if (!toggle && (e.target as HTMLElement).matches(":focus-visible")) show(true);
      }}
      onBlur={(e) => {
        if (toggle && wrapRef.current?.contains(e.relatedTarget as Node | null)) return;
        close();
      }}
      onPointerDown={() => {
        if (!toggle) hide();
      }}
    >
      {child}
      <div
        ref={tipRef}
        id={id}
        role={toggle ? undefined : "tooltip"}
        aria-hidden={toggle ? true : undefined}
        popover="manual"
        onPointerEnter={cancelHide}
        onPointerLeave={leave}
        className="max-w-64 rounded-inner bg-navy-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-pop"
      >
        {content}
      </div>
      {toggle && (
        // The popover is visual only; this polite region reads the text once, when it opens.
        <span className="sr-only" aria-live="polite">
          {pinned ? content : ""}
        </span>
      )}
    </span>
  );
}
