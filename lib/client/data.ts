"use client";

/**
 * Tiny fetch hooks for the files in public/data/ (written by scripts/build-public-data.ts), with an in-memory cache
 * shared by every screen, loading and error states, and retry. No dependencies.
 *
 *   const { status, data, error, retry } = useQueue();
 *   status: "idle" (no id given) | "loading" | "ready" | "error"
 *
 * The first render (on the server and during hydration) is always "loading" unless the file is already cached, so
 * static pages never mismatch. Fetches start in an effect, never during render.
 * Every patient, message and result is fictional demo material.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Baseline } from "@/lib/types";
import type { CaseFile, Helpline, PersonasFile, PublicEvalReport, PublicMeta, QueueFile, StaffMember } from "./types";

export type ResourceStatus = "idle" | "loading" | "ready" | "error";

export interface DataError {
  kind: "not_found" | "network" | "bad_data";
  /** Plain words, safe to show: "This message could not be found." */
  message: string;
}

export interface Resource<T> {
  status: ResourceStatus;
  data: T | undefined;
  error: DataError | undefined;
  /** status === "loading" (a convenience for skeletons). */
  isLoading: boolean;
  /** Forget a failed fetch and try again. */
  retry: () => void;
}

/**
 * Prefix for every data URL. Empty at the root; set NEXT_PUBLIC_BASE_PATH at build time when the app is served from
 * a sub-path (it must match next.config basePath). Absolute paths keep working under trailingSlash pages like /desk/.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

export function dataUrl(file: string): string {
  return `${BASE_PATH}/data/${file.replace(/^\/+/, "")}`;
}

const CASE_ID = /^MSG-\d{4}$/;

export function caseFile(id: string): string {
  return `cases/${id}.json`;
}

// ---------- The cache ----------

interface Entry {
  snapshot: Resource<unknown>;
  promise?: Promise<unknown>;
  listeners: Set<() => void>;
}

const cache = new Map<string, Entry>();

function makeSnapshot(key: string, status: ResourceStatus, data?: unknown, error?: DataError): Resource<unknown> {
  return { status, data, error, isLoading: status === "loading", retry: () => retryResource(key) };
}

function entryFor(key: string): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { snapshot: makeSnapshot(key, "loading"), listeners: new Set() };
    cache.set(key, e);
  }
  return e;
}

function publish(key: string, snapshot: Resource<unknown>) {
  const e = entryFor(key);
  e.snapshot = snapshot;
  e.listeners.forEach((l) => l());
}

function friendly(kind: DataError["kind"], file: string): DataError {
  const what = file.startsWith("cases/") ? "This message" : "This data";
  if (kind === "not_found") return { kind, message: `${what} could not be found.` };
  if (kind === "bad_data") return { kind, message: `${what} could not be read. Reloading the page usually fixes it.` };
  return { kind, message: "Could not load the demo data. Check your connection and try again." };
}

/** Fetches (once) and caches a public data file. Resolves with the parsed JSON; rejects with a DataError. */
export function loadData<T>(file: string): Promise<T> {
  const e = entryFor(file);
  if (e.snapshot.status === "ready") return Promise.resolve(e.snapshot.data as T);
  if (e.promise) return e.promise as Promise<T>;
  if (e.snapshot.status === "error") publish(file, makeSnapshot(file, "loading"));
  const p = (async () => {
    let res: Response;
    try {
      res = await fetch(dataUrl(file), { credentials: "same-origin" });
    } catch {
      throw friendly("network", file);
    }
    if (res.status === 404) throw friendly("not_found", file);
    if (!res.ok) throw friendly("network", file);
    try {
      return (await res.json()) as T;
    } catch {
      throw friendly("bad_data", file);
    }
  })();
  e.promise = p;
  p.then(
    (data) => {
      e.promise = undefined;
      publish(file, makeSnapshot(file, "ready", data));
    },
    (err: unknown) => {
      e.promise = undefined;
      const error = isDataError(err) ? err : friendly("network", file);
      publish(file, makeSnapshot(file, "error", undefined, error));
    },
  );
  return p;
}

function isDataError(v: unknown): v is DataError {
  return !!v && typeof v === "object" && "kind" in v && "message" in v;
}

function retryResource(key: string) {
  const e = cache.get(key);
  if (!e || e.snapshot.status !== "error") return;
  void loadData(key).catch(() => {});
}

/** Start loading a file early (for example a case on row hover) without rendering anything. */
export function prefetchData(file: string): void {
  void loadData(file).catch(() => {});
}

export function prefetchCase(id: string): void {
  if (CASE_ID.test(id)) prefetchData(caseFile(id));
}

/** The cached value, if the file has loaded. */
export function peekData<T>(file: string): T | undefined {
  const e = cache.get(file);
  return e?.snapshot.status === "ready" ? (e.snapshot.data as T) : undefined;
}

/** Tests only: forget everything. */
export function _resetDataCache(): void {
  cache.clear();
}

// ---------- The hook ----------

const IDLE: Resource<unknown> = { status: "idle", data: undefined, error: undefined, isLoading: false, retry: () => {} };
const LOADING_SERVER: Resource<unknown> = {
  status: "loading",
  data: undefined,
  error: undefined,
  isLoading: true,
  retry: () => {},
};

/** Any public data file. `file` is relative to public/data/, e.g. "queue.json". Pass null for an idle resource. */
export function useData<T>(file: string | null): Resource<T> {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!file) return () => {};
      const e = entryFor(file);
      e.listeners.add(cb);
      return () => {
        e.listeners.delete(cb);
      };
    },
    [file],
  );
  const getSnapshot = useCallback(() => (file ? entryFor(file).snapshot : IDLE), [file]);
  const getServerSnapshot = useCallback(() => (file ? LOADING_SERVER : IDLE), [file]);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!file) return;
    const e = entryFor(file);
    // Load on mount; a failed fetch waits for retry() rather than looping.
    if (e.snapshot.status === "loading" && !e.promise) void loadData(file).catch(() => {});
  }, [file]);

  return snap as Resource<T>;
}

// ---------- Named hooks ----------

/** The desk and clinician queue rows, in display order. Combine with the session through useDeskQueue(). */
export function useQueue(): Resource<QueueFile> {
  return useData<QueueFile>("queue.json");
}

/** One ticket: message, thread, full PipelineResult, patient, alerts and locks. Pass null or undefined for idle. */
export function useCase(id: string | null | undefined): Resource<CaseFile> {
  const valid = !!id && CASE_ID.test(id);
  const res = useData<CaseFile>(valid ? caseFile(id!) : null);
  if (id && !valid) {
    return {
      status: "error",
      data: undefined,
      error: { kind: "not_found", message: "This message could not be found." },
      isLoading: false,
      retry: () => {},
    };
  }
  return res;
}

export function useEvalReport(): Resource<PublicEvalReport> {
  return useData<PublicEvalReport>("eval-report.json");
}

export function useBaseline(): Resource<Baseline> {
  return useData<Baseline>("baseline.json");
}

export function useHelplines(): Resource<Helpline[]> {
  return useData<Helpline[]>("helplines.json");
}

export function useStaff(): Resource<StaffMember[]> {
  return useData<StaffMember[]>("staff.json");
}

export function usePersonas(): Resource<PersonasFile> {
  return useData<PersonasFile>("personas.json");
}

/** Models, versions and isMock: when isMock is true, show the small "Sample results" notice. */
export function useMeta(): Resource<PublicMeta> {
  return useData<PublicMeta>("meta.json");
}

/**
 * Whether to show the "Sample results" notice. Fails closed: true unless meta.json has loaded and says the results
 * came from real models (isMock === false), so a failed or slow meta.json never hides the label on sample figures.
 * A failed meta.json is retried once per mount, so the label can go away once the real answer arrives.
 */
export function useIsSample(): boolean {
  const meta = useMeta();
  const failed = meta.status === "error";
  const retry = meta.retry;
  const retried = useRef(false);
  useEffect(() => {
    if (!failed || retried.current) return;
    retried.current = true;
    retry();
  }, [failed, retry]);
  return !(meta.status === "ready" && meta.data?.isMock === false);
}
