import { describe, expect, it } from "vitest";
import { LlmError, createMockClient, type LlmClient } from "@/lib/pipeline";
import { LIVE_BUDGET, SpendLedger, budgetClient, deadlineSignal, estimateCallUsd } from "@/worker/budget";

const SORT_INPUT = { text: "Hi, has my order shipped yet?", channel: "chat" as const, country: "AU" as const, thread: [] };

function memoryLedger(start = 0) {
  let value = start;
  const writes: number[] = [];
  const ledger = new SpendLedger(
    {
      read: async () => value,
      write: async (total) => {
        value = total;
        writes.push(total);
      },
    },
    start,
    0,
  );
  return { ledger, writes, value: () => value };
}

/** A client whose calls resolve only when the test says so. */
function slowClient() {
  const mock = createMockClient();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((r) => (release = r));
  const client: LlmClient = {
    async sort(input) {
      await gate;
      const out = await mock.sort(input);
      return { ...out, model: "claude-haiku-4-5", usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.0015 } };
    },
    draft: mock.draft,
  };
  return { client, release: () => release?.() };
}

describe("live budget", () => {
  it("keeps the run deadline below the page's idle timeout, with room for one step", async () => {
    const { LIVE_TIMEOUT_MS } = await import("@/components/try/live");
    expect(LIVE_BUDGET.runDeadlineMs).toBeLessThan(LIVE_TIMEOUT_MS - 5000);
    expect(LIVE_BUDGET.maxRetries).toBeLessThanOrEqual(1);
  });

  it("estimates a call at its full output allowance", () => {
    expect(estimateCallUsd("claude-opus-5", 1000, 8000)).toBeCloseTo((1000 * 5 + 8000 * 25) / 1e6, 6);
  });
});

describe("budgetClient", () => {
  it("books an estimate before the call and swaps it for the real cost after", async () => {
    const { ledger, value } = memoryLedger(0.5);
    const { client, release } = slowClient();
    const ac = new AbortController();
    const b = budgetClient(client, { signal: ac.signal, ledger, sortModel: "claude-haiku-4-5", draftModel: "claude-opus-5" });
    const call = b.client.sort(SORT_INPUT);
    await ledger.settled();
    // While the call runs, its estimate already counts towards the day's spend.
    expect(value()).toBeGreaterThan(0.5);
    expect(b.bookedUsd()).toBeGreaterThan(0.0015);
    release();
    await call;
    await b.drain(1000);
    expect(b.bookedUsd()).toBeCloseTo(0.0015, 6);
    expect(value()).toBeCloseTo(0.5015, 6);
  });

  it("abandons a call at the deadline, keeps its estimate, then reconciles when it settles", async () => {
    const { ledger, value } = memoryLedger(0);
    const { client, release } = slowClient();
    const ac = new AbortController();
    const b = budgetClient(client, { signal: ac.signal, ledger, sortModel: "claude-haiku-4-5", draftModel: "claude-opus-5" });
    const call = b.client.sort(SORT_INPUT);
    ac.abort();
    const err = await call.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe("unavailable");
    await ledger.settled();
    const estimate = value();
    expect(estimate).toBeGreaterThan(0.0015);
    // The page has its answer; the abandoned call finishes later and its real cost replaces the estimate.
    release();
    await b.drain(1000);
    expect(value()).toBeCloseTo(0.0015, 6);
  });

  it("starts no new call once the deadline has passed or the page has gone", async () => {
    const { ledger, writes } = memoryLedger(0);
    let calls = 0;
    const inner: LlmClient = {
      async sort() {
        calls++;
        throw new Error("should not run");
      },
      async draft() {
        calls++;
        throw new Error("should not run");
      },
    };
    const ac = new AbortController();
    ac.abort();
    const b = budgetClient(inner, { signal: ac.signal, ledger, sortModel: "claude-haiku-4-5", draftModel: "claude-opus-5" });
    await expect(b.client.sort(SORT_INPUT)).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls).toBe(0);
    await ledger.settled();
    expect(writes).toEqual([]);
  });

  it("releases the estimate for a failure that was never billed, and keeps real usage from a failure that was", async () => {
    const { ledger, value } = memoryLedger(0);
    const inner: LlmClient = {
      async sort() {
        throw new LlmError("unavailable", "Claude could not sort the message (HTTP 529): overloaded");
      },
      async draft() {
        throw new LlmError("invalid_output", "cut off", { usage: { inputTokens: 100, outputTokens: 8000, costUsd: 0.2 } });
      },
    };
    const b = budgetClient(inner, { signal: new AbortController().signal, ledger, sortModel: "claude-haiku-4-5", draftModel: "claude-opus-5" });
    await expect(b.client.sort(SORT_INPUT)).rejects.toBeInstanceOf(LlmError);
    await b.drain(1000);
    expect(value()).toBe(0);
    await expect(
      b.client.draft({ text: "Hi, has my order shipped yet?", category: "order_status", channel: "chat", country: "AU", sources: [] }),
    ).rejects.toBeInstanceOf(LlmError);
    await b.drain(1000);
    expect(value()).toBeCloseTo(0.2, 6);
  });
});

describe("SpendLedger", () => {
  it("never overwrites a parallel run's spend, and batches writes", async () => {
    let stored = 1;
    const writes: number[] = [];
    const ledger = new SpendLedger(
      {
        read: async () => stored,
        write: async (v) => {
          stored = v;
          writes.push(v);
        },
      },
      1,
      0,
    );
    ledger.add(0.25);
    await ledger.settled();
    stored = 2; // another try spent in the meantime
    ledger.add(0.1);
    ledger.add(-0.05);
    await ledger.settled();
    expect(stored).toBeCloseTo(2.05, 6);
    expect(writes.length).toBeLessThanOrEqual(3);
  });
});

describe("deadlineSignal", () => {
  it("aborts when any source aborts", () => {
    const page = new AbortController();
    const s = deadlineSignal(60_000, page.signal);
    expect(s.aborted).toBe(false);
    page.abort();
    expect(s.aborted).toBe(true);
  });
});
