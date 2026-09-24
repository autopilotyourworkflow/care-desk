/**
 * Fixed positioning for popovers and tooltips. Popovers live in the top layer, so they are never clipped by an
 * overflow ancestor. Coordinates are viewport based (position: fixed).
 */
export type Align = "start" | "end" | "center";
export type Side = "bottom" | "top";

const GAP = 8;
const EDGE = 12;

/** Place a menu under (or above) its trigger. Works before the floating element has been measured. */
export function placeMenu(trigger: HTMLElement, floating: HTMLElement, align: Align = "start"): void {
  const r = trigger.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const s = floating.style;
  s.position = "fixed";
  s.margin = "0";
  s.inset = "auto";
  s.transform = "";
  const below = vh - r.bottom;
  const openUp = below < 220 && r.top > below;
  if (openUp) {
    s.bottom = `${vh - r.top + GAP}px`;
    s.maxHeight = `${Math.max(160, r.top - GAP - EDGE)}px`;
  } else {
    s.top = `${r.bottom + GAP}px`;
    s.maxHeight = `${Math.max(160, vh - r.bottom - GAP - EDGE)}px`;
  }
  if (align === "end") {
    s.right = `${Math.max(EDGE, vw - r.right)}px`;
  } else if (align === "center") {
    s.left = `${Math.max(EDGE, r.left + r.width / 2)}px`;
    s.transform = "translateX(-50%)";
  } else {
    s.left = `${Math.max(EDGE, Math.min(r.left, vw - EDGE - 200))}px`;
  }
}

/** Place a tooltip centred above its anchor, flipping below and clamping to the viewport. Call after showing it. */
export function placeTooltip(anchor: HTMLElement, tip: HTMLElement, side: Side = "top"): void {
  const r = anchor.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  let top = side === "top" ? r.top - t.height - GAP : r.bottom + GAP;
  if (side === "top" && top < EDGE) top = r.bottom + GAP;
  if (side === "bottom" && top + t.height > window.innerHeight - EDGE) top = r.top - t.height - GAP;
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(EDGE, Math.min(left, vw - t.width - EDGE));
  const s = tip.style;
  s.position = "fixed";
  s.margin = "0";
  s.inset = "auto";
  s.top = `${Math.round(top)}px`;
  s.left = `${Math.round(left)}px`;
}

/** True when a key event comes from a place where typing happens (so global shortcuts should not fire). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
