"use client";

/**
 * The 2-minute tour. Mounted once per page by AppShell. The position lives in sessionStorage (state.ts), so when a
 * step is on another page the provider navigates there and the next page's provider picks the tour up.
 *
 *   const { start } = useStartTour();   // works on pages with or without AppShell (the welcome has none)
 *
 * Help > Replay the tour fires TOUR_EVENT on window; the provider handles it and restarts from step 1.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loadData, useData } from "@/lib/client/data";
import { RESET_EVENT, useSession, type SessionApi } from "@/lib/client/session";
import type { PublicEvalReport, QueueFile } from "@/lib/client/types";
import { normalizePath, TOUR_EVENT } from "@/components/shell/roles";
import { useToast } from "@/components/ui/Toast";
import { isTypingTarget } from "@/components/ui/floating";
import { focusableIn, findAnchor, findSpan, scrollAnchorIntoView, SHEET_BREAKPOINT, useAnchor, usePlacement, useSheetClearance } from "./anchor";
import { getServerTourSnapshot, getTourSnapshot, subscribeTour, writeTour, type TourState } from "./state";
import { resolveTourIds, stopHref, STEP_NAMES, TOUR_STEP_COUNT, TOUR_STOPS, type TourContext, type TourIds } from "./steps";
import { TourAway, TourCard, TourSpotlight } from "./TourCard";
import { TourClosing } from "./TourClosing";

export interface TourApi {
  /** A tour is in progress. */
  active: boolean;
  /** Index into TOUR_STOPS, or null when no tour is running. */
  stop: number | null;
  /** Start (or restart) from the first step. */
  start: () => void;
  /** End the tour quietly. */
  end: () => void;
}

const TourCtx = createContext<TourApi | null>(null);

/** The tour controls, when a TourProvider is mounted (null on pages without AppShell). */
export function useTour(): TourApi | null {
  return useContext(TourCtx);
}

function usableFrom(session: SessionApi) {
  return {
    routine: (id: string) => !session.decisionFor(id),
    safety: (id: string) => {
      const c = session.clinicianFor(id);
      return !c.holdResumed && !c.cleared && !session.cleared.includes(id);
    },
  };
}

/** Picks the example messages (from queue.json and what this visitor has already done), never throwing. */
async function pickIds(session: SessionApi): Promise<TourIds> {
  let rows: QueueFile["items"] = [];
  try {
    rows = (await loadData<QueueFile>("queue.json")).items;
  } catch {
    /* fall back to the preferred ids */
  }
  return resolveTourIds(rows, usableFrom(session));
}

/**
 * Start the tour from anywhere. Inside AppShell it defers to the provider; on the welcome screen (no AppShell) it
 * stores the first step and navigates to the desk, where the desk's provider takes over.
 */
export function useStartTour(): { start: () => void; starting: boolean } {
  const ctx = useContext(TourCtx);
  const router = useRouter();
  const session = useSession();
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const [starting, setStarting] = useState(false);

  const start = useCallback(() => {
    if (ctx) {
      ctx.start();
      return;
    }
    setStarting(true);
    void pickIds(sessionRef.current).then((ids) => {
      writeTour({ v: 1, stop: 0, ids, navigated: 0, arrived: -1, focus: true });
      router.push(stopHref(TOUR_STOPS[0], ids));
    });
  }, [ctx, router]);

  return { start, starting };
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** A menu or panel on the popover API is open (tooltips are manual popovers and do not count). */
function menuOpen(): boolean {
  try {
    return !!document.querySelector('[popover="auto"]:popover-open');
  } catch {
    return false;
  }
}

function onStopPage(state: TourState, strict: boolean): boolean {
  const stop = TOUR_STOPS[state.stop];
  if (normalizePath(window.location.pathname) !== normalizePath(stop.path)) return false;
  if (!strict || !stop.message) return true;
  return new URLSearchParams(window.location.search).get("m") === state.ids[stop.message];
}

export function TourProvider({ children }: { children?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const session = useSession();
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const { toast } = useToast();

  const tour = useSyncExternalStore(subscribeTour, getTourSnapshot, getServerTourSnapshot);
  const popRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const focusedFor = useRef<string | null>(null);
  const scrolledFor = useRef<string | null>(null);

  const start = useCallback(() => {
    void pickIds(sessionRef.current).then((ids) => {
      focusedFor.current = null;
      scrolledFor.current = null;
      writeTour({ v: 1, stop: 0, ids, navigated: -1, arrived: -1, focus: true });
    });
  }, []);

  const end = useCallback(() => writeTour(null), []);

  // Help > Replay the tour, and Reset the demo (which clears the stored position too).
  useEffect(() => {
    const onReplay = (e: Event) => {
      e.preventDefault();
      start();
    };
    const onReset = () => writeTour(null);
    window.addEventListener(TOUR_EVENT, onReplay);
    window.addEventListener(RESET_EVENT, onReset);
    return () => {
      window.removeEventListener(TOUR_EVENT, onReplay);
      window.removeEventListener(RESET_EVENT, onReset);
    };
  }, [start]);

  const stop = tour ? TOUR_STOPS[tour.stop] : null;
  const onPage = !!stop && normalizePath(pathname) === normalizePath(stop.path);

  // Go to the page for this stop, once per stop; then note that its page has been reached.
  useEffect(() => {
    if (!tour) return;
    if (tour.navigated !== tour.stop) {
      const here = onStopPage(tour, true);
      writeTour({ ...tour, navigated: tour.stop, arrived: here ? tour.stop : tour.arrived });
      if (!here) router.push(stopHref(TOUR_STOPS[tour.stop], tour.ids));
      return;
    }
    if (onPage && tour.arrived !== tour.stop) writeTour({ ...tour, arrived: tour.stop });
  }, [tour, onPage, router]);

  // The visitor may wander off to another page mid-tour: offer to resume rather than dragging them back.
  const away = !!tour && !onPage && tour.arrived === tour.stop;

  const tourKey = tour ? `${tour.stop}:${tour.ids.routine}:${tour.ids.safety}` : null;
  // A stop whose page reveals its target slowly (TourStop.settleMs) shows the card once it has landed. No wait with
  // reduced motion, where nothing moves.
  const settleMs = stop?.settleMs && !prefersReducedMotion() ? stop.settleMs : 0;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    if (!settleMs || !tourKey || !onPage) return;
    const t = window.setTimeout(() => setSettledKey(tourKey), settleMs);
    return () => window.clearTimeout(t);
  }, [settleMs, tourKey, onPage]);
  const settled = !settleMs || settledKey === tourKey;
  const anchorName = stop?.anchor ?? null;
  const anchor = useAnchor(
    tour && onPage && anchorName ? [anchorName, ...(stop!.fallback ?? [])] : null,
    () => (tour ? onStopPage(tour, true) : false),
    tourKey,
  );
  const status = anchor.status;
  const el = anchor.el;
  // While the next anchor on the same page is being found, the card stays up (at the previous anchor), so focus and
  // position carry over. On a fresh page it waits until the anchor is found, or known to be missing. The closing card
  // has no anchor, so it shows straight away.
  const showCard = !!tour && onPage && settled && (!anchorName || status !== "searching" || !!el);
  const cardEl = anchorName ? el : null;
  const sheetSpan = stop?.sheetSpan ?? null;
  const placement = usePlacement(showCard ? cardEl : null, popRef, showCard, stop?.park ?? null, stop?.keepClear, sheetSpan);
  // On a phone the card is a sheet over the bottom of the page: keep focused controls out from under it.
  useSheetClearance(showCard && placement?.mode === "sheet", popRef, !!stop?.sheetSpan);

  // Copy context, all from data.
  const queue = useData<QueueFile>(tour ? "queue.json" : null);
  const evalReport = useData<PublicEvalReport>(tour && stop?.anchor === "tests-headline" ? "eval-report.json" : null);
  const ctx: TourContext = useMemo(() => {
    const rows = queue.data?.items ?? [];
    const r = tour ? rows.find((x) => x.messageId === tour.ids.routine) : undefined;
    const s = tour ? rows.find((x) => x.messageId === tour.ids.safety) : undefined;
    return {
      routine: r ? { firstName: r.firstName, category: r.category } : undefined,
      safety: s ? { firstName: s.firstName, holdOrders: s.holdOrders, reason: s.reason } : undefined,
      totals: evalReport.data?.totals,
    };
  }, [queue.data, evalReport.data, tour]);

  const title = stop ? stop.title(ctx) : "";
  const body = stop ? stop.body(ctx) : "";

  // Bring the anchor into view once per stop, and again if the stop's anchor is replaced (a fallback giving way to the
  // stop's own anchor, or a screen opening what the stop points at, such as the fact check's list of facts).
  const scrolledEl = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!el || !tourKey || status !== "found") return;
    if (scrolledFor.current === tourKey && scrolledEl.current === el) return;
    scrolledFor.current = tourKey;
    scrolledEl.current = el;
    // On a phone a stop with a sheetSpan scrolls to its marker line rather than to the anchor (see TourStop.sheetSpan).
    const span = () => (window.innerWidth < SHEET_BREAKPOINT ? findSpan(sheetSpan) : null);
    const run = () => {
      if (el.isConnected) scrollAnchorIntoView(el, prefersReducedMotion(), popRef.current, span());
    };
    run();
    // Once more when the page and the card have settled (late data can change the target's height, and the card's own
    // height is only final once it is placed). It does nothing when the card already fits beside the target.
    const again = window.setTimeout(run, 750);
    // An anchor that grows soon after it is found (evidence that opens once the trail has ticked through) is brought
    // into view again, for a short while only, so a visitor's own scrolling is never fought.
    let ro: ResizeObserver | undefined;
    let last = el.getBoundingClientRect().height;
    let settle = 0;
    try {
      ro = new ResizeObserver(() => {
        const h = el.getBoundingClientRect().height;
        if (Math.abs(h - last) < 24) return;
        last = h;
        window.clearTimeout(settle);
        settle = window.setTimeout(run, 260);
      });
      ro.observe(el);
    } catch {
      /* no ResizeObserver: the second pass above still runs */
    }
    const stopWatching = window.setTimeout(() => ro?.disconnect(), 3000);
    return () => {
      window.clearTimeout(again);
      window.clearTimeout(settle);
      window.clearTimeout(stopWatching);
      ro?.disconnect();
    };
    // sheetSpan belongs to the stop, and tourKey changes with the stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, tourKey, status]);

  // Hand focus to the tour when it moved because of a tour control (once per stop). Only once the card is measured
  // and visible (an invisible button cannot take focus), and only marked done once focus has actually landed, so a
  // failed attempt is retried on the next frames.
  const measured = !!placement;
  useEffect(() => {
    if (!showCard || !measured || !tour?.focus || !tourKey || focusedFor.current === tourKey) return;
    let tries = 0;
    let id = 0;
    const attempt = () => {
      const btn = nextRef.current;
      if (btn) {
        btn.focus({ preventScroll: true });
        if (document.activeElement === btn) {
          focusedFor.current = tourKey;
          return;
        }
      }
      if (++tries < 20) id = window.requestAnimationFrame(attempt);
    };
    id = window.requestAnimationFrame(attempt);
    return () => window.cancelAnimationFrame(id);
  }, [showCard, measured, tourKey, tour?.focus]);

  const announcement =
    showCard && stop
      ? stop.end
        ? `Tour complete. ${title}. ${body}`
        : `Tour, step ${stop.step} of ${TOUR_STEP_COUNT}, ${STEP_NAMES[stop.step - 1]}. ${title}. ${body}`
      : "";

  const go = useCallback(
    (to: number) => {
      if (!tour) return;
      const next = Math.min(Math.max(to, 0), TOUR_STOPS.length - 1);
      if (next === tour.stop) return;
      writeTour({ ...tour, stop: next, navigated: -1, arrived: -1, focus: true });
    },
    [tour],
  );

  const close = useCallback(
    (how: "skip" | "finish") => {
      writeTour(null);
      if (how === "finish") {
        const input = findAnchor("try-input");
        const target = input ? focusableIn(input) : null;
        if (target) target.focus();
        else document.getElementById("main")?.focus({ preventScroll: true });
        toast({ message: "That's the tour", detail: "Replay it any time from Help.", tone: "success" });
      } else {
        document.getElementById("main")?.focus({ preventScroll: true });
        toast({ message: "Tour closed", detail: "Replay it any time from Help." });
      }
    },
    [toast],
  );

  const isLast = !!tour && tour.stop === TOUR_STOPS.length - 1;
  const next = useCallback(() => (isLast ? close("finish") : tour && go(tour.stop + 1)), [isLast, close, go, tour]);
  const back = useCallback(() => tour && go(tour.stop - 1), [go, tour]);
  const skip = useCallback(() => close("skip"), [close]);

  // Keyboard: Esc closes from anywhere except a typing field or an open menu (which closes itself first). The arrows
  // move only when focus is in the tour or on the page itself, so they never steal a list's or a field's arrows.
  useEffect(() => {
    if (!tour || away) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as Element | null;
      if (e.key === "Escape") {
        if (isTypingTarget(e.target) || menuOpen()) return;
        e.preventDefault();
        skip();
        return;
      }
      const inTour = !!t && !!popRef.current?.contains(t);
      const onPage = !t || t === document.body || t === document.documentElement || (t as HTMLElement).id === "main";
      if (!inTour && !onPage) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour, away, next, back, skip]);

  const api = useMemo<TourApi>(() => ({ active: !!tour, stop: tour?.stop ?? null, start, end }), [tour, start, end]);

  return (
    <TourCtx.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-tour-ui="">
        {announcement}
      </div>
      {tour && stop && showCard && (
        <>
          <TourSpotlight spot={placement?.spot ?? null} dim={!!stop.end} />
          <TourCard
            ref={popRef}
            nextRef={nextRef}
            stopIndex={tour.stop}
            step={stop.step}
            title={title}
            body={body}
            placement={placement}
            isFirst={tour.stop === 0}
            isLast={isLast}
            end={!!stop.end}
            onNext={next}
            onBack={back}
            onSkip={skip}
          >
            {stop.end && <TourClosing />}
          </TourCard>
        </>
      )}
      {tour && stop && away && (
        <TourAway step={stop.step} end={!!stop.end} onResume={() => router.push(stopHref(stop, tour.ids))} onEnd={skip} />
      )}
    </TourCtx.Provider>
  );
}
