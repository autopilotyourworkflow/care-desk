"use client";

import { useSearchParams } from "next/navigation";
import { forwardRef, useEffect, useImperativeHandle, useRef, useSyncExternalStore } from "react";

/**
 * Private (VIP) links and the optional bot check for the live box.
 *
 * A private link is any page with ?k=<token> (the root layout reads it). The token is kept in sessionStorage for this tab (so it survives a reload and
 * moving around the site), removed from the address bar, and sent to the Worker as the X-Care-Desk-Key header.
 * Turnstile only exists when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set at build time, and private links skip it.
 */

const KEY = "caredesk.try.key";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{12,256}$/;

function readStored(): string | undefined {
  try {
    const v = window.sessionStorage.getItem(KEY) ?? undefined;
    return v && TOKEN_SHAPE.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** A tiny external store: the token for this tab, read from sessionStorage once, updated from the URL. */
let memo: { value: string | undefined } | null = null;
const listeners = new Set<() => void>();

function getKey(): string | undefined {
  memo ??= { value: readStored() };
  return memo.value;
}

function setKey(value: string): void {
  memo = { value };
  try {
    window.sessionStorage.setItem(KEY, value);
  } catch {
    /* storage blocked: keep it in memory for this visit */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The private-link token for this tab, if any. Reads only the tab store, so the page around it still prerenders. */
export function useVipKey(): string | undefined {
  return useSyncExternalStore(subscribe, getKey, () => undefined);
}

/**
 * Picks up ?k= from the address bar and stores it for this tab. It reads the search params, so render it inside its
 * own <Suspense fallback={null}>: that way only this empty component waits for the browser, not the whole page.
 */
export function VipKeyFromUrl(): null {
  const params = useSearchParams();
  const fromUrl = params?.get("k") ?? null;

  useEffect(() => {
    if (fromUrl === null) return;
    if (TOKEN_SHAPE.test(fromUrl)) setKey(fromUrl);
    // Take the token out of the address bar, so it is not copied or shown on screen by accident.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("k");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* ignore */
    }
  }, [fromUrl]);

  return null;
}

// ---------- Turnstile ----------

export const TURNSTILE_SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "").trim();

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not load")));
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile did not load"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  /** The current token, once. The widget resets for the next try. */
  take(): string | undefined;
}

/**
 * The bot check, rendered only when a site key was set at build time. It usually passes without any interaction
 * ("interaction-only" appearance), and the Worker skips it for private links.
 */
export const TurnstileBox = forwardRef<TurnstileHandle, { enabled: boolean }>(function TurnstileBox({ enabled }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const token = useRef<string | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    take() {
      const t = token.current;
      token.current = undefined;
      try {
        if (widget.current) window.turnstile?.reset(widget.current);
      } catch {
        /* ignore */
      }
      return t;
    },
  }));

  useEffect(() => {
    if (!enabled || !TURNSTILE_SITE_KEY || !el.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !el.current) return;
        widget.current = ts.render(el.current, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: "interaction-only",
          size: "flexible",
          callback: (t: string) => {
            token.current = t;
          },
          "expired-callback": () => {
            token.current = undefined;
          },
          "error-callback": () => {
            token.current = undefined;
          },
        });
      })
      .catch(() => {
        /* no bot check available: the Worker then declines, and the page runs the rules in the browser */
      });
    return () => {
      cancelled = true;
      try {
        if (widget.current) window.turnstile?.remove(widget.current);
      } catch {
        /* ignore */
      }
      widget.current = null;
    };
  }, [enabled]);

  if (!enabled || !TURNSTILE_SITE_KEY) return null;
  return <div ref={el} className="min-h-0 empty:hidden" />;
});
