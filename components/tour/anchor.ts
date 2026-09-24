"use client";

/**
 * Finding and following the element a tour stop points at. Anchors are data-tour attributes that other screens add,
 * sometimes after their data loads, so this polls gently instead of assuming the element is there on first render.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

export function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const check = (el as HTMLElement & { checkVisibility?: (o?: Record<string, boolean>) => boolean }).checkVisibility;
  if (typeof check === "function" && !check.call(el, { visibilityProperty: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * Anchors the tour can find inside another anchor when the screen has not tagged them itself: the trail's list of
 * seven steps inside the desk's check trail card (the desk tags each of its rows with data-step), and the parts of the
 * draft and the clinician screen named below.
 */
export const DERIVED: Record<string, string> = {
  "desk-trail-steps": '[data-tour="desk-trail"] ol:has(> li[data-step])',
  // The "Facts come from these sources" list under the draft: each record or policy section with the numbers the
  // reply cites it by. No tour stop points at it at present; it stays so a stop can light the sources again.
  "desk-citations": '[data-tour="desk-draft"] div:has(> p + ul > li)',
  // The reply text itself, with its numbered citation markers, which the card steps off while the list is lit.
  "desk-draft-text": '[data-tour="desk-draft"] p:has(button[aria-label^="Source "])',
  // The first citation marker in the reply, and the first source in the list under it: on a phone the "Every fact has
  // a source" stop lights the span between them, since the marker and the whole list rarely fit above the sheet.
  "desk-cite-first": '[data-tour="desk-draft"] p button[aria-label^="Source "]',
  "desk-cite-item": '[data-tour="desk-draft"] [data-tour="desk-citations"] li:first-child',
  // That source's number, name and record id, without its text.
  "desk-cite-head": '[data-tour="desk-draft"] [data-tour="desk-citations"] li:first-child > div > div > :first-child',
  // The clinician's queue column, which the card sits over while the clinician steps point at the case beside it.
  "clinician-queue": 'section[aria-labelledby="clinician-rail-title"]',
  // The estimated saving at the top of "Your numbers", which the Insights stop's copy points at.
  "insights-saving": '[data-tour="insights-assumptions"] [aria-live="polite"]',
};

function firstVisible(selector: string): HTMLElement | null {
  let list: NodeListOf<HTMLElement>;
  try {
    list = document.querySelectorAll<HTMLElement>(selector);
  } catch {
    return null;
  }
  for (const el of Array.from(list)) {
    if (el.closest("[data-tour-ui]")) continue;
    if (isVisible(el)) return el;
  }
  return null;
}

/** The first visible element with this data-tour name (a page may render a desktop and a phone copy). */
export function findAnchor(name: string): HTMLElement | null {
  let own: HTMLElement | null = null;
  try {
    own = firstVisible(`[data-tour="${CSS.escape(name)}"]`);
  } catch {
    return null;
  }
  if (own) return own;
  const derived = DERIVED[name];
  return derived ? firstVisible(derived) : null;
}

/** The anchor's first focusable control, for handing focus over when the tour finishes. */
export function focusableIn(el: HTMLElement): HTMLElement | null {
  if (el.matches("textarea, input, select, button, [contenteditable='true'], [tabindex]:not([tabindex='-1'])")) return el;
  return el.querySelector<HTMLElement>("textarea, input:not([type='hidden']), select, [contenteditable='true'], button");
}

export type AnchorStatus = "searching" | "found" | "missing";

/** How long to wait for an anchor before showing the centred card instead. It keeps looking afterwards. */
const MISSING_AFTER_MS = 1200;
/** How long to wait for the URL to catch up after a navigation before accepting whatever is on the page. */
const LOCATION_GRACE_MS = 1800;
/** How long the stop's own anchor gets before a fallback anchor is accepted. */
const FALLBACK_AFTER_MS = 700;

/**
 * Watches for the first of `names` on the page (the stop's anchor, then its fallbacks). `locationOk` says whether the page is showing the right thing yet (the right
 * ?m= message), so an anchor from the previous message is never picked up mid-navigation.
 */
export function useAnchor(
  names: readonly string[] | null,
  locationOk: () => boolean,
  key: string | null,
): { el: HTMLElement | null; status: AnchorStatus; key: string | null } {
  // One state object, so the element, its status and the stop it was found for always change together. While the
  // next anchor is being found the previous element is kept, so the spotlight can glide rather than blink.
  const [found, setFound] = useState<{ el: HTMLElement | null; status: AnchorStatus; key: string | null }>({
    el: null,
    status: "searching",
    key: null,
  });

  const name = names?.join(" ") ?? null;
  useEffect(() => {
    if (!names || !names.length) return;
    const [primary, ...fallbacks] = names;
    const t0 = performance.now();
    let current: HTMLElement | null | undefined;
    let last: AnchorStatus = "searching";
    const check = () => {
      const waited = performance.now() - t0;
      const ready = waited > LOCATION_GRACE_MS || locationOk();
      // The stop's own anchor wins; a broader fallback (for example the whole trail) is used if it is not there.
      let el = ready ? findAnchor(primary) : null;
      if (!el && ready && waited > FALLBACK_AFTER_MS) {
        for (const f of fallbacks) {
          el = findAnchor(f);
          if (el) break;
        }
      }
      const status: AnchorStatus = el ? "found" : waited > MISSING_AFTER_MS ? "missing" : "searching";
      if (status === "searching") return;
      if (el !== current || status !== last) {
        current = el;
        last = status;
        setFound({ el, status, key });
      }
    };
    check();
    const iv = window.setInterval(check, 180);
    return () => window.clearInterval(iv);
    // locationOk reads window.location each call, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);

  if (!name) return { el: null, status: "searching", key };
  // Still looking for this stop's anchor: keep the previous element (if any) and say so.
  if (found.key !== key) return { el: found.el, status: "searching", key };
  return found;
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Placement {
  /** "anchored" beside the anchor, "sheet" docked to the bottom on a phone, "centred" when there is no anchor. */
  mode: "anchored" | "sheet" | "centred";
  /** Popover position (anchored mode only), with a narrower width when it sits over a slim column. */
  pos: { top: number; left: number; width?: number } | null;
  /** The spotlight box, or null when the anchor is off screen or missing. */
  spot: (Box & { radius: number }) | null;
  /** The target spans most of the screen, so the card sits below or above it and drops its keyboard hint to fit. */
  compact?: boolean;
}

export const SHEET_BREAKPOINT = 640;
const GAP = 14;
const EDGE = 16;
const PAD = 6;
const TOP_BAR = 64;
/** The card's natural width (matches the w-[min(360px,...)] class on the card). */
const CARD_W = 360;
/** The narrowest column the card may sit over. */
const PARK_MIN_W = 260;
/** The narrowest the card may get to fit beside a target rather than over it. */
const SIDE_MIN_W = 290;
/** The spotlight ring's width beyond the lit box (the 2px white plus 2px navy rings in TourSpotlight). */
const RING = 4;

/**
 * A list row's bottom padding is the space before the next row. Light the row's content, not that space, so the ring
 * never cuts into the row below.
 */
function trailingSpace(el: HTMLElement): number {
  if (el.tagName !== "LI" || !el.nextElementSibling) return 0;
  try {
    const pb = parseFloat(getComputedStyle(el).paddingBottom);
    return Number.isFinite(pb) && pb > PAD + RING ? pb : 0;
  } catch {
    return 0;
  }
}

function pinned(el: Element | null, anchor: HTMLElement | null): boolean {
  for (let n: Element | null = el, i = 0; n && n !== document.body && i < 8; n = n.parentElement, i++) {
    if (n.closest("[data-tour-ui]")) return false;
    const pos = getComputedStyle(n).position;
    if (pos === "sticky" || pos === "fixed") {
      // A sticky column that holds the anchor is content, not a bar; nor is anything tall.
      if (anchor && n.contains(anchor)) return false;
      return n.getBoundingClientRect().height < 180;
    }
  }
  return false;
}

/**
 * How much of the top of the viewport is covered by pinned bars (the app's top bar, plus any sticky sub-bar a screen
 * adds, such as the desk's "Back to the queue" row on a phone). Sampled at a few points, so it is cheap.
 */
export function topInset(anchor: HTMLElement | null): number {
  const vw = window.innerWidth;
  let inset = 0;
  try {
    for (let y = 2; y < 260; y += 6) {
      const hit = [vw / 2, 24, vw - 24].some((x) => pinned(document.elementFromPoint(x, y), anchor));
      if (!hit) break;
      inset = y + 6;
    }
  } catch {
    return TOP_BAR;
  }
  return Math.max(inset, TOP_BAR);
}

/** The nearest ancestor that scrolls on its own (the desk's reply column on wide screens), or null for the page. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    try {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) return n;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The bottom of the part of the screen where the anchor can be seen: the viewport, cut short by the column the anchor
 * scrolls in, and by any bar stuck over the anchor's lower part (the desk's Send / Edit / Escalate bar, which sticks to
 * the bottom of the reply column). A bar that sits in its normal place below the anchor covers nothing and is ignored.
 */
export function visibleBottom(el: HTMLElement): number {
  let bottom = window.innerHeight;
  const r = el.getBoundingClientRect();
  const col = scrollParent(el);
  if (col) bottom = Math.min(bottom, col.getBoundingClientRect().bottom);
  let bars: HTMLElement[] = [];
  try {
    bars = Array.from(document.querySelectorAll<HTMLElement>("[data-bottombar], .sticky.bottom-0"));
  } catch {
    return bottom;
  }
  for (const bar of bars) {
    if (bar.contains(el) || el.contains(bar) || bar.closest("[data-tour-ui]") || !isVisible(bar)) continue;
    let pos = "";
    try {
      pos = getComputedStyle(bar).position;
    } catch {
      continue;
    }
    if (pos !== "sticky" && pos !== "fixed") continue;
    const b = bar.getBoundingClientRect();
    const across = b.left < r.right - 1 && b.right > r.left + 1;
    if (across && b.top > r.top + 1 && b.top < r.bottom - 1) bottom = Math.min(bottom, b.top);
  }
  return bottom;
}

/** The top of the part of the screen where the anchor can be seen: under the pinned bars, and inside its column. */
function visibleTop(el: HTMLElement, inset: number): number {
  const col = scrollParent(el);
  return col ? Math.max(inset, col.getBoundingClientRect().top) : inset;
}

function radiusOf(el: HTMLElement): number {
  try {
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius);
    return Number.isFinite(r) ? Math.min(r + PAD, 30) : 16;
  } catch {
    return 16;
  }
}

/** A viewport rectangle, as getBoundingClientRect gives it. */
export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/** The inputs to placeCard: plain numbers, so it can be reasoned about (and tested) without a page. */
export interface CardGeometry {
  vw: number;
  vh: number;
  popW: number;
  popH: number;
  /** The top of the visible area, under the sticky bars. */
  areaTop: number;
  target: Rect;
  /** A column the card may sit over (clear of the target), or null. */
  park?: Rect | null;
  /** Things the stop's copy refers to, which the card should not cover when it can avoid them. */
  keep?: Rect[];
}

/** Wider than this share of the viewport, a target gets the card below or above it, never beside it in a corner. */
export const WIDE_SHARE = 0.6;

function hits(a: Rect, b: Rect): boolean {
  // One pixel of tolerance, so a card that only touches an edge does not count.
  return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
}

/** The target is taller than the visible area, so the card may sit over part of it (it cannot fit anywhere else). */
export function isTall(g: Pick<CardGeometry, "vh" | "areaTop" | "target">): boolean {
  return g.target.bottom - g.target.top > g.vh - g.areaTop - 16;
}

/**
 * Where the card goes (anchored mode). The card never covers the target unless the target is taller than the visible
 * area, and it steps off anything in `keep` when there is room to. Order of preference: over the park column; below or
 * above a wide target (beside a narrower one); then the other sides.
 */
export function placeCard(g: CardGeometry): { top: number; left: number; width?: number } {
  const { vw, vh, popW, popH, areaTop, target: r } = g;
  const keep = g.keep ?? [];
  const minTop = areaTop + 12;
  const maxTop = vh - popH - EDGE;
  const clampY = (y: number) => Math.min(Math.max(y, minTop), maxTop);
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), vw - popW - EDGE);
  const visTop = Math.max(r.top, minTop);
  const rectOf = (p: { top: number; left: number; width?: number }): Rect => ({
    top: p.top,
    left: p.left,
    right: p.left + (p.width ?? popW),
    bottom: p.top + popH,
  });
  const clearOfTarget = (p: { top: number; left: number; width?: number }) => !hits(rectOf(p), r);
  const fits = (top: number) => top >= minTop - 0.5 && top <= maxTop + 0.5;

  /** Slides a candidate up or down off anything in `keep`, as long as it stays clear of the target and on screen. */
  const stepOffKeep = <P extends { top: number; left: number; width?: number }>(p: P): P => {
    let out = p;
    for (const k of keep) {
      if (!hits(rectOf(out), k)) continue;
      const moved = [k.bottom + GAP, k.top - GAP - popH]
        .map((top) => ({ ...out, top }))
        .find((q) => fits(q.top) && clearOfTarget(q) && keep.every((other) => !hits(rectOf(q), other)));
      if (moved) out = moved;
    }
    return out;
  };

  // Over the park column, when it is clear of the target: on the desk the card stays in one place for the whole
  // chapter and both the message and the lit part of the reply stay readable.
  const park = g.park;
  if (park) {
    const pw = park.right - park.left;
    const clear = park.right <= r.left - 8 || park.left >= r.right + 8;
    if (clear && pw >= PARK_MIN_W) {
      const width = Math.round(Math.min(CARD_W, pw, vw - EDGE * 2));
      const left = Math.round(Math.max(park.left + (pw - width) / 2, EDGE));
      return stepOffKeep({ top: clampY(Math.max(visTop, park.top)), left, width });
    }
  }

  const rw = r.right - r.left;
  const wide = rw > vw * WIDE_SHARE;
  // An anchor at least as wide as the card: sit below or above it, inside its own column, so the card covers the
  // continuation of the same thing rather than the neighbouring column the copy may refer to.
  const columnWide = rw >= popW - 24;

  // Beside the target, at the card's own width or, when the gap is a little narrower, as wide as the gap allows.
  const rightRoom = vw - EDGE - (r.right + GAP);
  const leftRoom = r.left - GAP - EDGE;
  const sideWidth = (room: number) => (room >= popW ? undefined : room >= SIDE_MIN_W ? Math.floor(room) : null);
  const options: (() => { top: number; left: number; width?: number } | null)[] = [
    () => {
      const width = sideWidth(rightRoom);
      return width === null ? null : { left: r.right + GAP, top: clampY(visTop), width };
    },
    () => {
      const width = sideWidth(leftRoom);
      return width === null ? null : { left: r.left - GAP - (width ?? popW), top: clampY(visTop), width };
    },
    () => (r.bottom + GAP <= maxTop ? { top: Math.max(r.bottom + GAP, minTop), left: clampX(r.left) } : null),
    () => (r.top - GAP - popH >= minTop ? { top: r.top - GAP - popH, left: clampX(r.left) } : null),
  ];
  const order = wide || columnWide ? [2, 3, 0, 1] : [0, 1, 2, 3];
  for (const i of order) {
    const p = options[i]();
    if (p && clearOfTarget(p)) return stepOffKeep(p);
  }
  // No room on any side. A target taller than the screen may be covered in part: the bottom corner, over the target,
  // which stays lit. A wide target that fits on screen but not together with the card (a short laptop screen) keeps
  // its top in view and the card sits as low as it can in its bottom-left corner, where a two-column card's shorter
  // lead column usually leaves space.
  if (isTall(g)) return { top: maxTop, left: vw - popW - EDGE };
  return { top: clampY(r.bottom + GAP), left: clampX(r.left) };
}

/** The elements of a stop's sheetSpan, found on the page (see TourStop.sheetSpan). */
export interface SheetSpanEls {
  from: HTMLElement;
  to: HTMLElement[];
}

/** Lets a line box sit a little above an inline marker's or a character's own box (both are shorter than the line). */
const LINE_SLACK = 4;

/**
 * The part of a sheet-mode span to light, in viewport coordinates. `fromTops` are the places the lit area may start,
 * best first (the start of the paragraph holding the marker, then the marker's own line); `toBottoms` are where it may
 * end, longest first. The first pair whose span fits in `room` (the band between the top bar and the sheet) wins, so a
 * whole paragraph is preferred, since starting mid-paragraph puts the ring through the line above. With no pair that
 * fits, the last start and end are used. Only heights are compared, so the choice does not change as the page
 * scrolls. Plain numbers, so it can be tested without a page.
 */
export function pickSpan(fromTops: number | number[], toBottoms: number[], room: number): { top: number; bottom: number } | null {
  const froms = (Array.isArray(fromTops) ? fromTops : [fromTops]).map((t) => t - LINE_SLACK);
  if (!froms.length || !toBottoms.length) return null;
  const lit = 2 * (PAD + RING);
  for (const top of froms) {
    const bottom = toBottoms.find((b) => b > top && b - top + lit <= room);
    if (bottom !== undefined) return { top, bottom };
  }
  const top = froms[froms.length - 1];
  const bottom = toBottoms[toBottoms.length - 1];
  return bottom > top ? { top, bottom } : null;
}

/**
 * The top of the paragraph block (text after a blank line, or the start of the text) that holds `from`, read from the
 * rendered text, or null when there is no enclosing paragraph. The draft is one element with blank lines between its
 * paragraphs, so this walks its text rather than looking for elements.
 */
function blockTop(from: HTMLElement): number | null {
  const p = from.closest("p");
  if (!p) return null;
  try {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let at: { node: Text; offset: number } | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (from.contains(n) || from.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) break;
      const text = n.textContent ?? "";
      const re = /\n[ \t]*\n\s*/g;
      for (let m = re.exec(text); m; m = re.exec(text)) at = { node: n as Text, offset: m.index + m[0].length };
    }
    if (!at) return p.getBoundingClientRect().top + (parseFloat(getComputedStyle(p).paddingTop) || 0);
    // The first character after the blank line (in the next text node when the blank line ends this one).
    let node: Text | null = at.node;
    let offset = at.offset;
    while (node && offset >= (node.textContent?.length ?? 0)) {
      const next = walker.nextNode();
      node = next && !from.contains(next) ? (next as Text) : null;
      offset = 0;
    }
    if (!node) return null;
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const top = range.getBoundingClientRect().top;
    return Number.isFinite(top) ? top : null;
  } catch {
    return null;
  }
}

function spanBox(span: SheetSpanEls | null | undefined, room: number): { top: number; bottom: number } | null {
  if (!span || !span.from.isConnected) return null;
  const to = span.to.filter((t) => t.isConnected && isVisible(t));
  if (!to.length) return null;
  const line = span.from.getBoundingClientRect().top;
  const block = blockTop(span.from);
  const froms = block !== null && block < line - 1 ? [block, line] : [line];
  return pickSpan(froms, to.map((t) => t.getBoundingClientRect().bottom), room);
}

function toRect(el: HTMLElement): Rect {
  const b = el.getBoundingClientRect();
  return { top: b.top, left: b.left, right: b.right, bottom: b.bottom };
}

/**
 * Where the card goes. `park` is a column the card may sit over instead of beside the anchor (the desk's queue rail),
 * so that on the desk it never covers the patient's message between the rail and the reply. `keep` are elements the
 * stop's copy points at, which the card steps off when it can.
 */
export function computePlacement(
  el: HTMLElement | null,
  pop: HTMLElement | null,
  inset = TOP_BAR,
  park: HTMLElement | null = null,
  keep: HTMLElement[] = [],
  span: SheetSpanEls | null = null,
): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sheet = vw < SHEET_BREAKPOINT;
  const popH = pop?.offsetHeight ?? 240;
  // The card's natural width, not its measured one: a card narrowed to fit a gap must not read as a narrower card
  // next time round, or it would flip between widths.
  const popW = Math.min(CARD_W, vw - EDGE * 2);

  if (!el || !el.isConnected) return { mode: sheet ? "sheet" : "centred", pos: null, spot: null };

  const r = el.getBoundingClientRect();
  // The visible area: under the sticky top bar, above the docked sheet on a phone, inside the column the anchor
  // scrolls in, and above a bar stuck over it (the desk's Send bar), so the ring never frames what covers the anchor.
  const areaTop = inset;
  const areaBottom = Math.min(sheet ? vh - popH - 20 : vh, visibleBottom(el));
  // On a phone a stop may light a span (a marker in the reply down to the list it refers to) instead of the anchor.
  const sub = sheet ? spanBox(span, areaBottom - areaTop - 16) : null;
  const litTop = sub ? sub.top : r.top;
  const litBottom = sub ? sub.bottom : r.bottom - trailingSpace(el);
  const top = Math.max(litTop - PAD, visibleTop(el, areaTop) + 2 + RING);
  // The ring is drawn outside the lit box, so keep the box a ring's width inside the visible area on every side.
  const bottom = Math.min(litBottom + PAD, areaBottom - 2 - RING);
  const left = Math.max(r.left - PAD, 3 + RING);
  const right = Math.min(r.right + PAD, vw - 3 - RING);
  const spot = bottom - top > 12 && right - left > 12 ? { top, left, width: right - left, height: bottom - top, radius: radiusOf(el) } : null;

  if (sheet) return { mode: "sheet", pos: null, spot };

  // The card keeps clear of the lit box, ring included, not just the element.
  const lit = PAD + RING;
  const target: Rect = { top: r.top - lit, left: r.left - lit, right: r.right + lit, bottom: r.bottom + lit };
  const parkRect = park && park.isConnected && isVisible(park) ? toRect(park) : null;
  const keepRects = keep.filter((k) => k.isConnected && k !== el && isVisible(k)).map(toRect);
  const pos = placeCard({ vw, vh, popW, popH, areaTop, target, park: parkRect, keep: keepRects });
  return { mode: "anchored", pos, spot, compact: r.width > vw * WIDE_SHARE };
}

/** Keeps the placement in step with scrolling, resizing and layout changes on the page. */
export function usePlacement(
  el: HTMLElement | null,
  popRef: RefObject<HTMLElement | null>,
  active: boolean,
  parkName: string | null = null,
  keepNames: readonly string[] = [],
  spanNames: { from: string; to: readonly string[] } | null = null,
): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const keepKey = keepNames.join(" ");
  const spanKey = spanNames ? [spanNames.from, ...spanNames.to].join(" ") : "";

  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    const names = keepKey ? keepKey.split(" ") : [];
    const update = () => {
      frame = 0;
      const keep = names.map((n) => findAnchor(n)).filter((k): k is HTMLElement => !!k);
      const span = window.innerWidth < SHEET_BREAKPOINT ? findSpan(spanKey) : null;
      const next = computePlacement(el, popRef.current, el ? topInset(el) : TOP_BAR, parkName ? findAnchor(parkName) : null, keep, span);
      setPlacement((prev) => (prev && same(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    let ro: ResizeObserver | undefined;
    try {
      ro = new ResizeObserver(schedule);
      if (el) ro.observe(el);
      if (popRef.current) ro.observe(popRef.current);
    } catch {
      /* no ResizeObserver: the interval below still catches changes */
    }
    const iv = window.setInterval(schedule, 400);
    return () => {
      window.removeEventListener("scroll", schedule, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      window.clearInterval(iv);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [el, popRef, active, parkName, keepKey, spanKey]);

  return active ? placement : null;
}

/** A sheetSpan's elements from its names, or null when the marker or every target is missing. */
export function findSpan(names: string | { from: string; to: readonly string[] } | null | undefined): SheetSpanEls | null {
  if (!names) return null;
  const [from, ...to] = typeof names === "string" ? names.split(" ").filter(Boolean) : [names.from, ...names.to];
  const fromEl = from ? findAnchor(from) : null;
  const toEls = to.map((n) => findAnchor(n)).filter((t): t is HTMLElement => !!t);
  return fromEl && toEls.length ? { from: fromEl, to: toEls } : null;
}

function same(a: Placement, b: Placement): boolean {
  const r = (n: number | undefined) => Math.round(n ?? -1);
  return (
    a.mode === b.mode &&
    !!a.compact === !!b.compact &&
    r(a.pos?.top) === r(b.pos?.top) &&
    r(a.pos?.left) === r(b.pos?.left) &&
    r(a.pos?.width) === r(b.pos?.width) &&
    !!a.spot === !!b.spot &&
    r(a.spot?.top) === r(b.spot?.top) &&
    r(a.spot?.left) === r(b.spot?.left) &&
    r(a.spot?.width) === r(b.spot?.width) &&
    r(a.spot?.height) === r(b.spot?.height)
  );
}

/**
 * Brings the anchor into view under the sticky top bar (and above the docked sheet on a phone). A wide target with no
 * room for the card beside it is scrolled so its top sits near the top of the screen, leaving the card room below it.
 */
export function scrollAnchorIntoView(
  el: HTMLElement,
  reduced: boolean,
  pop: HTMLElement | null = null,
  span: SheetSpanEls | null = null,
): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sheet = vw < SHEET_BREAKPOINT;
  if (sheet && span && scrollSpanIntoView(span, reduced, pop)) return;
  const r = el.getBoundingClientRect();
  const prevTop = el.style.scrollMarginTop;
  const prevBottom = el.style.scrollMarginBottom;
  const inset = topInset(el);
  const popH = pop?.offsetHeight || 320;
  // An anchor inside a column that scrolls on its own (the desk's reply column) is scrolled within that column: its
  // margins are measured from the column's edges, not the screen's, and the column's own scroll padding already keeps
  // it clear of the Send bar stuck to the column's foot.
  const col = sheet ? null : scrollParent(el);
  const colBox = col?.getBoundingClientRect() ?? null;
  const areaTop = visibleTop(el, inset);
  const roomBottom = colBox && col ? colBox.bottom - (parseFloat(getComputedStyle(col).scrollPaddingBottom) || 0) : vh;
  el.style.scrollMarginTop = `${colBox ? Math.max(PAD + RING + 8, inset + 16 - colBox.top) : inset + 16}px`;
  el.style.scrollMarginBottom = sheet ? `${Math.round(vh * 0.5)}px` : "24px";
  const tall = r.height > roomBottom - areaTop - (colBox ? 40 : 120);
  let block: ScrollLogicalPosition | null = null;

  const wide = !sheet && r.width > vw * WIDE_SHARE && !isTall({ vh, areaTop: inset, target: r });
  if (wide) {
    const lit = PAD + RING;
    const cardFitsNow =
      (r.top - lit >= inset + 8 && r.bottom + lit + GAP + popH <= vh - EDGE) ||
      (r.top - lit - GAP - popH >= inset + 12 && r.bottom + lit <= vh - 16);
    const sideRoom = r.left - lit - GAP - SIDE_MIN_W >= EDGE || r.right + lit + GAP + SIDE_MIN_W <= vw - EDGE;
    const fitsBelow = r.height + 2 * lit + GAP + popH + EDGE <= vh - inset - 16;
    // Top first when the card fits below; also when it cannot fit anywhere clear, so the target's heading stays in view.
    if (!cardFitsNow && (fitsBelow || !sideRoom)) block = "start";
  }
  if (!block) {
    // In view means clear of the pinned bars at the top and of any bar stuck over the anchor at the bottom.
    const inView = r.top >= areaTop + 8 && r.bottom <= (sheet ? vh * 0.5 : visibleBottom(el) - 16);
    if (!inView) block = sheet || tall ? "start" : "center";
  }
  if (block) {
    // The margins above already allow for the bars and the sheet, so the root's scroll padding (set while the phone
    // sheet is up) is set aside for this one call rather than counted twice. The target position is taken at the call.
    const root = document.documentElement;
    const padTop = root.style.scrollPaddingTop;
    const padBottom = root.style.scrollPaddingBottom;
    root.style.scrollPaddingTop = "0px";
    root.style.scrollPaddingBottom = "0px";
    try {
      el.scrollIntoView({ block, inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    } catch {
      el.scrollIntoView();
    }
    root.style.scrollPaddingTop = padTop;
    root.style.scrollPaddingBottom = padBottom;
  }
  el.style.scrollMarginTop = prevTop;
  el.style.scrollMarginBottom = prevBottom;
}

/**
 * The phone version of scrollAnchorIntoView for a stop with a sheetSpan: the line holding the span's marker goes just
 * under the top bar, with what follows it (the list) in the band above the sheet. Does nothing when the span already
 * sits in that band. False when the span's elements are not usable, so the caller scrolls the anchor instead.
 */
function scrollSpanIntoView(span: SheetSpanEls, reduced: boolean, pop: HTMLElement | null): boolean {
  if (!span.from.isConnected) return false;
  const vh = window.innerHeight;
  const inset = topInset(span.from);
  const sheetTop = vh - (pop?.offsetHeight || 320) - 20;
  const box = spanBox(span, sheetTop - inset - 16);
  if (!box) return false;
  const lit = PAD + RING;
  if (box.top - lit >= inset + 4 && box.bottom + lit <= sheetTop - 2) return true;
  const root = document.documentElement;
  const padTop = root.style.scrollPaddingTop;
  const padBottom = root.style.scrollPaddingBottom;
  const prevTop = span.from.style.scrollMarginTop;
  // Zero, not cleared: the stylesheet has its own scroll padding for the bars, and the margin below already counts them.
  root.style.scrollPaddingTop = "0px";
  root.style.scrollPaddingBottom = "0px";
  // The lit area's top (a paragraph start or the marker's line) goes just under the bar; the marker is scrolled with
  // a margin that makes up the distance between the two.
  const offset = span.from.getBoundingClientRect().top - box.top;
  span.from.style.scrollMarginTop = `${Math.round(inset + 12 + lit + offset)}px`;
  try {
    span.from.scrollIntoView({ block: "start", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
  } catch {
    span.from.scrollIntoView();
  }
  span.from.style.scrollMarginTop = prevTop;
  root.style.scrollPaddingTop = padTop;
  root.style.scrollPaddingBottom = padBottom;
  return true;
}

/**
 * While the card is docked to the bottom of a phone screen, keeps focused elements out from under it (WCAG 2.4.11):
 * the root's scroll padding marks the sheet and the top bar as covered, so the browser scrolls a focused control into
 * the visible band; a spacer at the end of the page lets the last controls scroll clear of the sheet; and a focus
 * check scrolls anything that still lands under the sheet into view. Everything is undone when the sheet goes.
 */
export function useSheetClearance(active: boolean, popRef: RefObject<HTMLElement | null>, extraRoom = false): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const prevBottom = root.style.scrollPaddingBottom;
    const prevTop = root.style.scrollPaddingTop;
    const spacer = document.createElement("div");
    spacer.setAttribute("aria-hidden", "true");
    spacer.setAttribute("data-tour-ui", "");
    spacer.style.pointerEvents = "none";
    document.body.appendChild(spacer);

    /** How much of the bottom of the viewport the sheet covers, plus a little air. */
    const covered = () => {
      const pop = popRef.current;
      if (!pop) return 0;
      return Math.max(0, Math.round(window.innerHeight - pop.getBoundingClientRect().top)) + 16;
    };
    const apply = () => {
      const bottom = covered();
      root.style.scrollPaddingBottom = `${bottom}px`;
      root.style.scrollPaddingTop = `${topInset(null)}px`;
      // A stop with a sheetSpan scrolls its marker up under the top bar; near the end of a short page that needs more
      // room than the sheet itself covers. The extra space sits under the sheet.
      spacer.style.height = `${bottom + (extraRoom ? Math.round(window.innerHeight * 0.5) : 0)}px`;
    };
    apply();

    const onFocus = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || t.closest("[data-tour-ui]")) return;
      window.requestAnimationFrame(() => {
        const pop = popRef.current;
        if (!pop || document.activeElement !== t) return;
        const r = t.getBoundingClientRect();
        if (r.bottom > pop.getBoundingClientRect().top - 8 || r.top < topInset(null)) {
          try {
            t.scrollIntoView({ block: "nearest", inline: "nearest" });
          } catch {
            t.scrollIntoView(false);
          }
        }
      });
    };
    document.addEventListener("focusin", onFocus);
    window.addEventListener("resize", apply);
    let ro: ResizeObserver | undefined;
    try {
      ro = new ResizeObserver(apply);
      if (popRef.current) ro.observe(popRef.current);
    } catch {
      /* no ResizeObserver: the sheet's height is read again on resize */
    }
    return () => {
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("resize", apply);
      ro?.disconnect();
      spacer.remove();
      root.style.scrollPaddingBottom = prevBottom;
      root.style.scrollPaddingTop = prevTop;
    };
  }, [active, popRef, extraRoom]);
}
