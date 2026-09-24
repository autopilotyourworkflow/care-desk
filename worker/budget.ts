/**
 * The live box's time and money budget, so a run always answers the page in time and every Claude call counts
 * towards the daily cap, even one cut short.
 *
 *  - Time: each call gets its own SDK timeout and at most one retry (LIVE_BUDGET), and the whole run has a deadline
 *    below the page's idle timeout (components/try/live.ts). When the deadline passes, or the visitor's page goes away
 *    (request.signal), a call still in flight is abandoned as "unavailable": the pipeline then finishes with the
 *    labelled built-in stand-in for Claude straight away, and no new Claude call starts.
 *  - Money: before each call an estimate is booked against the day's spend (the call's prompt size plus its full
 *    output allowance, so it errs high). When the call settles, the estimate is swapped for the real cost. A call that
 *    never settles in time keeps its estimate, so a run cut short still counts.
 *
 * Nothing here sees or logs the message text beyond measuring the prompt's length.
 */
import { LlmError, MODEL_CONFIG, costUsd, type LlmClient } from "@/lib/pipeline";
import { DRAFT_SYSTEM_PROMPT, SORT_SYSTEM_PROMPT, buildDraftUserPrompt, buildSortUserPrompt } from "@/lib/pipeline/prompts";

export const LIVE_BUDGET = {
  /** Per attempt. Sorting is a short classification on the small model. */
  sortTimeoutMs: 10_000,
  /** Per attempt. The draft uses the larger model with thinking. */
  draftTimeoutMs: 25_000,
  maxRetries: 1,
  /** The whole run. Kept below the page's 45 s idle timeout, so the page always gets an answer. */
  runDeadlineMs: 38_000,
} as const;

/** KV allows about one write a second to the same key, so the spend ledger batches its writes. */
export const LEDGER_MIN_GAP_MS = 1100;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** A generous token count for a prompt: about three characters a token, which overestimates for English. */
function tokensFor(...parts: string[]): number {
  return Math.ceil(parts.reduce((n, p) => n + p.length, 0) / 3);
}

/** What one call could cost at most: its prompt, all of it billed as uncached input, plus its full output allowance. */
export function estimateCallUsd(model: string, promptTokens: number, maxOutputTokens: number): number {
  return costUsd(model, { inputTokens: promptTokens, outputTokens: maxOutputTokens });
}

export interface LedgerIo {
  read(): Promise<number>;
  write(total: number): Promise<void>;
}

/**
 * The day's spend for one tier, kept up to date during a run. add() may be called with negative amounts (an estimate
 * swapped for a smaller real cost). Writes are serialised and batched, and each one re-reads KV first, so a parallel
 * run's spend is not overwritten.
 */
export class SpendLedger {
  private pending = 0;
  private known: number;
  private lastWrite = Number.NEGATIVE_INFINITY;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly io: LedgerIo,
    base: number,
    private readonly minGapMs = LEDGER_MIN_GAP_MS,
  ) {
    this.known = base;
  }

  add(deltaUsd: number): void {
    if (!Number.isFinite(deltaUsd) || deltaUsd === 0) return;
    this.pending = round6(this.pending + deltaUsd);
    this.chain = this.chain.then(() => this.flush()).catch(() => {});
  }

  /** Resolves once every amount added so far has been written (or the write has failed and been logged). */
  settled(): Promise<void> {
    return this.chain;
  }

  private async flush(): Promise<void> {
    if (this.pending === 0) return;
    const gap = Date.now() - this.lastWrite;
    if (gap < this.minGapMs) await new Promise((r) => setTimeout(r, this.minGapMs - gap));
    const delta = this.pending;
    this.pending = 0;
    if (delta === 0) return;
    let latest = 0;
    try {
      latest = await this.io.read();
    } catch {
      latest = 0;
    }
    this.known = Math.max(0, round6(Math.max(latest, this.known) + delta));
    this.lastWrite = Date.now();
    await this.io.write(this.known);
  }
}

function isTimeout(err: unknown): boolean {
  const cause = err instanceof LlmError ? (err as { cause?: unknown }).cause : err;
  const name = cause instanceof Error ? cause.name : "";
  const msg = cause instanceof Error ? cause.message : "";
  return /timeout/i.test(name) || /timed? ?out/i.test(msg);
}

export interface BudgetedClient {
  client: LlmClient;
  /** Resolves when every call this run started has settled and been reconciled, or after waitMs, whichever is first. */
  drain(waitMs: number): Promise<void>;
  /** Cost booked by this run so far: real costs for settled calls, estimates for calls still in flight. */
  bookedUsd(): number;
}

/**
 * Wraps the Claude client for one live run. Calls are refused once `signal` has aborted, and a call in flight is
 * abandoned (rejected as "unavailable") the moment it aborts. Every call books its estimate on `ledger` before it
 * starts and is reconciled when it settles, even after it was abandoned.
 */
export function budgetClient(
  inner: LlmClient,
  opts: { signal: AbortSignal; ledger: SpendLedger; sortModel: string; draftModel: string },
): BudgetedClient {
  const inflight = new Set<Promise<unknown>>();
  let booked = 0;
  const book = (delta: number) => {
    booked = round6(booked + delta);
    opts.ledger.add(delta);
  };

  async function guarded<T extends { usage: { costUsd: number } }>(what: string, model: string, estimate: number, start: () => Promise<T>): Promise<T> {
    if (opts.signal.aborted) throw new LlmError("unavailable", `Time budget used up before Claude could ${what}`, { model });
    book(estimate);
    const call = start();
    const settle = call.then(
      (out) => book(round6(out.usage.costUsd - estimate)),
      (err: unknown) => {
        // Tokens reported with the failure are billed. A timeout may still be billed, so it keeps its estimate;
        // anything else without usage (a refused connection, a 429 or 5xx) was not, so the estimate is released.
        const usage = err instanceof LlmError ? err.usage : undefined;
        if (usage) book(round6(usage.costUsd - estimate));
        else if (!isTimeout(err)) book(-estimate);
      },
    );
    inflight.add(settle);
    void settle.finally(() => inflight.delete(settle));

    let onAbort: (() => void) | undefined;
    const abandoned = new Promise<never>((_, reject) => {
      onAbort = () => reject(new LlmError("unavailable", `Time budget used up while Claude was working to ${what}`, { model }));
      opts.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([call, abandoned]);
    } finally {
      if (onAbort) opts.signal.removeEventListener("abort", onAbort);
    }
  }

  const client: LlmClient = {
    sort(input) {
      const estimate = estimateCallUsd(opts.sortModel, tokensFor(SORT_SYSTEM_PROMPT, buildSortUserPrompt(input)), MODEL_CONFIG.sortMaxTokens);
      return guarded("sort the message", opts.sortModel, estimate, () => inner.sort(input));
    },
    draft(input) {
      const estimate = estimateCallUsd(opts.draftModel, tokensFor(DRAFT_SYSTEM_PROMPT, buildDraftUserPrompt(input)), MODEL_CONFIG.draftMaxTokens);
      return guarded("draft a reply", opts.draftModel, estimate, () => inner.draft(input));
    },
  };

  return {
    client,
    bookedUsd: () => booked,
    async drain(waitMs) {
      const all = Promise.all([...inflight]).then(() => opts.ledger.settled());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cap = new Promise<void>((r) => (timer = setTimeout(r, waitMs)));
      try {
        await Promise.race([all, cap]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** A signal that aborts after `ms`, or as soon as any of `others` aborts. */
export function deadlineSignal(ms: number, ...others: (AbortSignal | undefined | null)[]): AbortSignal {
  const list = [AbortSignal.timeout(ms), ...others.filter((s): s is AbortSignal => !!s)];
  return AbortSignal.any(list);
}
