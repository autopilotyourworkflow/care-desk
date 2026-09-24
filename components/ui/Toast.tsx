"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { CircleCheck, Info, OctagonAlert, Undo2, X } from "lucide-react";
import { cn } from "./cn";

export type ToastTone = "neutral" | "success" | "error";

export interface ToastOptions {
  message: string;
  /** Short secondary line, e.g. the patient's name. */
  detail?: string;
  tone?: ToastTone;
  /** Adds an Undo button. Called when the person undoes; the toast then closes. */
  onUndo?: () => void;
  /** Label for the undo button. Default "Undo". */
  undoLabel?: string;
  /** Milliseconds before it closes. Default 6000 (8000 with Undo). Paused while hovered or focused. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  /** Show a toast; returns its id. */
  toast: (opts: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Where toasts appear.
 *  - "auto" (default): on large screens, bottom right, over the detail columns and above the reply and decision bars
 *    at the foot of the desk and the clinician view (it measures them, see below), never over the queue on the left,
 *    whose next rows are the ones an agent reads next; on smaller screens, at the top under the header and under any sticky sub-bar
 *    stuck below it (the desk's "Back to the queue" bar). An in-flow control near the top (a back link) can opt in
 *    with `data-toast-avoid`, and a page can also set `--subbar-h` on <html> to reserve that space itself.
 *    A toast never sits over the element that has keyboard focus (WCAG 2.4.11): when its usual spot would cover it
 *    (the heading of the message that opens after Send, say), it moves to the other end of the screen, above any
 *    sticky bar at the bottom (the Send bar) or under the header, and it checks again whenever focus moves. It never
 *    sits over a bar at the bottom either (a page marks its own with data-bottombar): it re-measures whenever the page
 *    changes, so the Send bar of the message that opens after Send is cleared as soon as it mounts or moves.
 *  - "bottom-center": the classic spot, for pages with no action bar at the bottom.
 */
export type ToastPlacement = "auto" | "bottom-center";

/** At most this many toasts show at once; a new one replaces the oldest. */
const MAX_TOASTS = 2;

const REGION_CLASS: Record<ToastPlacement, string> = {
  auto: "inset-x-0 top-[calc(var(--topbar-h)+var(--subbar-h,0px)+0.5rem)] items-center px-4 lg:inset-x-auto lg:top-auto lg:bottom-6 lg:right-6 lg:w-[min(28rem,calc(100vw-3rem))] lg:items-end lg:px-0",
  "bottom-center": "inset-x-0 bottom-4 items-center px-4 sm:bottom-6",
};

/** Toasts for completed actions ("Sent. Next message opened.") with Undo. Wrap the page once (AppShell does this). */
export function ToastProvider({ children, placement = "auto" }: { children: ReactNode; placement?: ToastPlacement }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback((opts: ToastOptions) => {
    const id = nextId.current++;
    setItems((xs) => [...xs.slice(-(MAX_TOASTS - 1)), { ...opts, id }]);
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  const regionRef = useRef<HTMLDivElement>(null);
  const spot = useToastSpot(regionRef, placement === "auto" && items.length > 0, items.length);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        ref={regionRef}
        role="region"
        aria-label="Notifications"
        data-toast-region=""
        data-toast-slot={spot?.slot}
        className={cn("pointer-events-none fixed z-50 flex flex-col gap-2", REGION_CLASS[placement])}
        style={spot ? spotStyle(spot) : undefined}
      >
        {/* Live region: announcements are polite so they never interrupt typing */}
        <div
          aria-live="polite"
          aria-atomic="false"
          className={cn("flex w-full flex-col gap-2", placement === "auto" ? "items-center lg:items-end" : "items-center")}
        >
          {items.map((t) => (
            <ToastView key={t.id} item={t} onClose={() => dismiss(t.id)} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

/** Below this width the "auto" region sits at the top of the screen (Tailwind's lg breakpoint). */
const PHONE_QUERY = "(max-width: 1023.98px)";

/** A box on screen, in viewport px. */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The two places an "auto" toast can sit: under the header, or above the bottom of the screen. */
export type ToastSlot = "top" | "bottom";

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Which slot keeps the toast off the focused element: the usual one while it is clear, else the other end of the
 * screen; when both would touch it (a very tall field), whichever covers less of it.
 */
export function pickToastSlot(preferred: ToastSlot, slots: Record<ToastSlot, Box>, focus: Box | null): ToastSlot {
  if (!focus) return preferred;
  const usual = overlapArea(slots[preferred], focus);
  if (usual === 0) return preferred;
  const other: ToastSlot = preferred === "top" ? "bottom" : "top";
  return overlapArea(slots[other], focus) < usual ? other : preferred;
}

/** Where the region sits: its slot, and its distance in px from the top (slot "top") or the bottom (slot "bottom"). */
export interface ToastSpot {
  slot: ToastSlot;
  offset: number;
}

function spotStyle(spot: ToastSpot) {
  return spot.slot === "top" ? { top: spot.offset, bottom: "auto" } : { top: "auto", bottom: spot.offset };
}

function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/** The box of the sticky or fixed bar (under a third of the screen tall) an element sits in, if any. Never a toast. */
function stickyBar(el: Element): DOMRect | null {
  if (el.closest("[data-toast-region]")) return null;
  let n: Element | null = el;
  while (n && n !== document.body) {
    const pos = getComputedStyle(n).position;
    if (pos === "sticky" || pos === "fixed") {
      const r = n.getBoundingClientRect();
      return r.height < window.innerHeight / 3 ? r : null;
    }
    n = n.parentElement;
  }
  return null;
}

/** Points across the toast's width to probe for sticky bars: near its two edges and its middle. */
function probeXs(left: number, right: number): number[] {
  return [Math.max(left + 12, 1), (left + right) / 2, Math.min(right - 12, window.innerWidth - 1)];
}

/**
 * The bottom edge of the header plus any sticky or fixed bar stuck just under it, in px, plus a small gap. Reads the
 * page at the moment a toast shows, so a toast never covers "Back to the queue" or the previous and next buttons.
 */
function measureTopEdge(xs: number[]): number {
  const rem = remPx();
  const topbar = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 4) * rem;
  const probeY = topbar + 4;
  let bottom = topbar;
  for (const x of xs) {
    for (const el of document.elementsFromPoint(x, probeY)) {
      const r = stickyBar(el);
      if (r && r.top <= probeY && r.bottom > bottom) bottom = r.bottom;
    }
  }
  // In-flow controls a page marks with data-toast-avoid (a back link at the top of a phone view) while they sit in the
  // band a toast would cover.
  for (const el of document.querySelectorAll<HTMLElement>("[data-toast-avoid]")) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.bottom > topbar && r.top < topbar + 6 * rem) bottom = Math.max(bottom, r.bottom);
  }
  return Math.round(bottom + 0.5 * rem);
}

/**
 * Distance from the bottom of the screen that a toast keeps clear, in px: above the highest bar that reaches the bottom
 * band of the screen (the Send, Edit and Escalate bar, stuck or still settling into place), plus a gap. A bar that
 * starts in the top third of the screen is a panel, not a bar, and is ignored.
 */
export function bottomClearance(bars: readonly Box[], viewportH: number, min: number, gap: number): number {
  let top = viewportH;
  for (const r of bars) {
    if (r.bottom <= r.top) continue;
    const onScreen = r.top < viewportH && r.bottom > viewportH * 0.75;
    if (onScreen && r.top > viewportH / 3 && r.top < top) top = r.top;
  }
  return Math.max(min, Math.round(viewportH - top + gap));
}

/**
 * Distance from the bottom of the screen to the top of any bar stuck there (the Send bar), plus a gap: bars a page
 * marks with data-bottombar or data-toast-avoid, and any sticky or fixed bar under the bottom edge of the toast's width.
 */
function measureBottomEdge(xs: number[], min: number): number {
  const h = window.innerHeight;
  const probeY = h - 4;
  const bars: Box[] = [];
  for (const x of xs) {
    for (const el of document.elementsFromPoint(x, probeY)) {
      const r = stickyBar(el);
      if (r && r.bottom >= probeY) bars.push(r);
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-bottombar], [data-toast-avoid]")) {
    if (el.closest("[data-toast-region]")) continue;
    bars.push(el.getBoundingClientRect());
  }
  return bottomClearance(bars, h, min, 0.5 * remPx());
}

/** The focused element's box; null when nothing is focused; "in-toast" when focus is on a toast (it then stays put). */
function focusBox(region: HTMLElement): Box | null | "in-toast" {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  if (region.contains(el)) return "in-toast";
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0 ? r : null;
}

/**
 * While "auto" toasts show, where the region sits, kept up to date on scroll, resize and every focus move. Null when
 * no toast shows, and the region keeps its CSS spot.
 */
function useToastSpot(regionRef: RefObject<HTMLDivElement | null>, active: boolean, count: number): ToastSpot | null {
  const [spot, setSpot] = useState<ToastSpot | null>(null);
  const current = useRef<ToastSpot | null>(null);
  // Layout effect: measured before paint, so the first toast never flashes over the sub-bar or the focused heading.
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!active || !region || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(PHONE_QUERY);
    let frame = 0;
    const measure = () => {
      const focus = focusBox(region);
      if (focus === "in-toast" && current.current) return;
      const rem = remPx();
      const box = region.getBoundingClientRect();
      const inner = region.firstElementChild?.getBoundingClientRect();
      const height = inner && inner.height > 0 ? inner.height : box.height;
      const xs = probeXs(box.left, box.right);
      const top = measureTopEdge(xs);
      const bottom = measureBottomEdge(xs, (mq.matches ? 1 : 1.5) * rem);
      const h = window.innerHeight;
      const slots: Record<ToastSlot, Box> = {
        top: { top, bottom: top + height, left: box.left, right: box.right },
        bottom: { top: h - bottom - height, bottom: h - bottom, left: box.left, right: box.right },
      };
      const slot = pickToastSlot(mq.matches ? "top" : "bottom", slots, focus === "in-toast" ? null : focus);
      const next: ToastSpot = { slot, offset: slot === "top" ? top : bottom };
      const prev = current.current;
      if (prev && prev.slot === next.slot && prev.offset === next.offset) return;
      current.current = next;
      setSpot(next);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    // The page keeps changing while a toast shows: the next message opens and its Send bar mounts, then settles into
    // place. Re-measure on every change to the page and, for bars that move without one (layout settling), a few
    // times a second, so the toast never sits over the bar for longer than a moment.
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver((records) => {
      if (records.some((r) => !region.contains(r.target))) update();
    });
    observer?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    const resizer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resizer?.observe(document.body);
    const poll = window.setInterval(update, 250);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    mq.addEventListener?.("change", update);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      resizer?.disconnect();
      window.clearInterval(poll);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      mq.removeEventListener?.("change", update);
      current.current = null;
    };
  }, [active, count, regionRef]);
  return active ? spot : null;
}

/** Access toasts. Outside a provider it falls back to a no-op so components never crash in isolation. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? { toast: () => 0, dismiss: () => {} };
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const { message, detail, tone = "neutral", onUndo, undoLabel = "Undo" } = item;
  const duration = item.duration ?? (onUndo ? 8000 : 6000);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const started = useRef(0);

  useEffect(() => {
    if (paused) return;
    started.current = Date.now();
    const t = window.setTimeout(onClose, remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current -= Date.now() - started.current;
    };
  }, [paused, onClose]);

  const Icon = tone === "success" ? CircleCheck : tone === "error" ? OctagonAlert : Info;

  return (
    <div
      className="pointer-events-auto flex w-full max-w-md animate-toast-in items-center gap-3 rounded-control bg-navy-900 py-2.5 pl-4 pr-2 text-sm text-white shadow-pop"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon
        aria-hidden
        size={18}
        className={cn("shrink-0", tone === "success" ? "text-[#7fe0a8]" : tone === "error" ? "text-[#ffb3b3]" : "text-on-navy-muted")}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{message}</p>
        {detail && <p className="truncate text-xs text-on-navy-muted">{detail}</p>}
      </div>
      {onUndo && (
        <button
          type="button"
          onClick={() => {
            onUndo();
            onClose();
          }}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-inner bg-white/10 px-3 text-xs font-semibold text-white transition-colors duration-150 hover:bg-white/20 active:bg-white/25"
        >
          <Undo2 aria-hidden size={14} />
          {undoLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss notification"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-inner text-on-navy-muted transition-colors duration-150 hover:bg-white/10 hover:text-white"
      >
        <X aria-hidden size={16} />
      </button>
    </div>
  );
}
