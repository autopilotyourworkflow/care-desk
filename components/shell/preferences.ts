"use client";

import { useSyncExternalStore } from "react";

/**
 * Per-viewer keyboard preference: whether one-key shortcuts (J, K, E, X, / and ?) are on. WCAG 2.1.4 asks for a way
 * to turn them off, for speech-input and switch users whose tools type letters. Kept in this browser only, with every
 * storage access in try/catch (a private window or blocked storage falls back to memory for the visit). Chords such as
 * Ctrl+Enter are not affected.
 */
const KEY = "caredesk.singleKeys.v1";

let memory: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function getSingleKeys(): boolean {
  return memory ?? (memory = read());
}

export function setSingleKeys(on: boolean): void {
  memory = on;
  try {
    if (on) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, "off");
  } catch {
    /* storage blocked: keep it in memory for this visit */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      memory = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** One-key shortcuts on or off. On by default, and on the server. */
export function useSingleKeys(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, getSingleKeys, () => true);
  return [on, setSingleKeys];
}
