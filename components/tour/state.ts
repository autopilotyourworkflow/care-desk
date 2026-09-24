"use client";

/**
 * Where the tour is, kept in sessionStorage so moving between pages keeps it going (each page mounts its own
 * AppShell, and with it a fresh TourProvider). Every access is wrapped: with storage blocked the position lives in
 * memory for this visit, which still survives client-side navigation.
 */
import type { TourIds } from "./steps";
import { TOUR_STOPS } from "./steps";

export const TOUR_STORAGE_KEY = "caredesk.tour.v2";
/** Fired on window whenever the stored position changes in this tab, so a mounted provider can follow. */
export const TOUR_CHANGE_EVENT = "caredesk:tour-change";

export interface TourState {
  v: 1;
  /** Index into TOUR_STOPS. */
  stop: number;
  ids: TourIds;
  /** The stop we last navigated for, so a page that tidies its query string never causes a second navigation. */
  navigated: number;
  /** The stop whose page a provider has actually shown. Until then a navigation is still under way. */
  arrived: number;
  /** Move keyboard focus into the popover when it next appears (true after any tour control). */
  focus: boolean;
}

let memory: TourState | null = null;

function valid(v: unknown): v is TourState {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<TourState>;
  return (
    s.v === 1 &&
    typeof s.stop === "number" &&
    Number.isInteger(s.stop) &&
    s.stop >= 0 &&
    s.stop < TOUR_STOPS.length &&
    !!s.ids &&
    typeof s.ids.routine === "string" &&
    typeof s.ids.safety === "string" &&
    /^MSG-\d{4}$/.test(s.ids.routine) &&
    /^MSG-\d{4}$/.test(s.ids.safety)
  );
}

export function readTour(): TourState | null {
  try {
    const raw = window.sessionStorage.getItem(TOUR_STORAGE_KEY);
    if (raw == null) return null; // cleared (for example by Reset the demo)
    const parsed: unknown = JSON.parse(raw);
    if (valid(parsed)) {
      return {
        ...parsed,
        navigated: typeof parsed.navigated === "number" ? parsed.navigated : -1,
        arrived: typeof parsed.arrived === "number" ? parsed.arrived : -1,
        focus: !!parsed.focus,
      };
    }
    return null;
  } catch {
    return memory;
  }
}

export function writeTour(state: TourState | null): void {
  memory = state;
  snapshot = state;
  try {
    if (state) window.sessionStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state));
    else window.sessionStorage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    /* storage blocked: memory only */
  }
  try {
    window.dispatchEvent(new CustomEvent(TOUR_CHANGE_EVENT));
  } catch {
    /* no window */
  }
}

// ---------- A tiny external store, for useSyncExternalStore ----------

let snapshot: TourState | null | undefined;

/** The current position (read from storage once, then kept in step by writeTour). */
export function getTourSnapshot(): TourState | null {
  if (snapshot === undefined) snapshot = readTour();
  return snapshot;
}

export function getServerTourSnapshot(): TourState | null {
  return null;
}

export function subscribeTour(cb: () => void): () => void {
  const onChange = () => cb();
  window.addEventListener(TOUR_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(TOUR_CHANGE_EVENT, onChange);
}
