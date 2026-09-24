import { describe, expect, it } from "vitest";
import worker, { type Env } from "@/worker/index";
import type { StepEvent } from "@/lib/types";

/** An in-memory stand-in for the KV binding (get, put). */
function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const kv = {
    async get(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
  return { kv, store };
}

function makeEnv(over: Partial<Env> = {}, kvInit: Record<string, string> = {}) {
  const { kv, store } = fakeKv(kvInit);
  const env = { CARE_DESK_KV: kv, MOCK: "1", ...over } as unknown as Env;
  return { env, store };
}

function makeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      pending.push(p);
    },
    passThroughOnException() {},
    props: {},
  };
  return { ctx: ctx as unknown as Parameters<typeof worker.fetch>[2], settle: () => Promise.all(pending) };
}

function tryRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://caredesk.example/api/try", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", "user-agent": "vitest", ...headers },
    body: JSON.stringify(body),
  });
}

async function events(res: Response): Promise<StepEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as StepEvent);
}

describe("worker /api/health", () => {
  it("answers ok without revealing secrets", async () => {
    const { env } = makeEnv({ ANTHROPIC_API_KEY: "sk-secret", ADMIN_TOKEN: "admin-secret-token" });
    const { ctx } = makeCtx();
    const res = await worker.fetch(new Request("https://x/api/health"), env, ctx);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ ok: true, ai: true, mock: true });
    expect(body).not.toContain("secret");
  });
});

describe("worker /api/try", () => {
  it("streams every step, then the done event", async () => {
    const { env, store } = makeEnv();
    const { ctx, settle } = makeCtx();
    const res = await worker.fetch(tryRequest({ personaId: "PT-1001", text: "Hi, has my order shipped yet? When should it arrive?" }), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const ev = await events(res);
    await settle();
    const steps = ev.filter((e) => e.type === "step");
    expect(steps.map((e) => (e.type === "step" ? e.step.id : ""))).toEqual(["redact", "rules", "sort", "sources", "draft", "check", "decide"]);
    const done = ev[ev.length - 1];
    expect(done.type).toBe("done");
    if (done.type === "done") {
      expect(done.result.route).toBe("draft");
      expect(done.result.draft?.text).toContain("[FIRST_NAME]");
    }
    // Counters only: the message text is never stored.
    for (const v of store.values()) expect(v).not.toContain("shipped");
    expect([...store.keys()].some((k) => k.startsWith("visitor:public:"))).toBe(true);
  });

  it("stops a safety message at the rules, with no draft", async () => {
    const { env } = makeEnv();
    const { ctx, settle } = makeCtx();
    const res = await worker.fetch(tryRequest({ personaId: "PT-1031", text: "Is it OK to take my oil with my sleeping tablets?" }), env, ctx);
    const ev = await events(res);
    await settle();
    const done = ev.find((e) => e.type === "done");
    expect(done && done.type === "done" && done.result.route).toBe("clinician");
    expect(done && done.type === "done" && done.result.draft).toBeUndefined();
  });

  it("rejects bad input with a plain error event", async () => {
    const { env } = makeEnv();
    const { ctx } = makeCtx();
    const res = await worker.fetch(tryRequest({ personaId: "PT-9999", text: "hi" }), env, ctx);
    expect(res.status).toBe(400);
    const [e] = await events(res);
    expect(e).toEqual({ type: "error", message: "Pick one of the three sample patients." });
    const long = await worker.fetch(tryRequest({ personaId: "PT-1001", text: "a".repeat(1201) }), env, ctx);
    expect(long.status).toBe(400);
  });

  it("answers limited once the visitor reaches the hourly limit set in KV", async () => {
    const { env } = makeEnv({}, { config: JSON.stringify({ perVisitorPerHour: 2 }) });
    const { ctx, settle } = makeCtx();
    const body = { personaId: "PT-1043", text: "Can I pause my plan for a month?" };
    for (let i = 0; i < 2; i++) {
      const ev = await events(await worker.fetch(tryRequest(body), env, ctx));
      expect(ev.some((e) => e.type === "done")).toBe(true);
    }
    const third = await events(await worker.fetch(tryRequest(body), env, ctx));
    await settle();
    expect(third).toHaveLength(1);
    expect(third[0]).toMatchObject({ type: "limited", reason: "visitor" });
    // Another visitor is not affected.
    const other = await events(await worker.fetch(tryRequest(body, { "cf-connecting-ip": "198.51.100.4" }), env, ctx));
    expect(other.some((e) => e.type === "done")).toBe(true);
  });

  it("lets a VIP token past the public limits, on its own budget", async () => {
    const { env } = makeEnv({ VIP_TOKENS: "vip-token-for-tests" }, { config: JSON.stringify({ perVisitorPerHour: 0, dailyUsd: 0 }) });
    const { ctx, settle } = makeCtx();
    const body = { personaId: "PT-1001", text: "Has my order shipped?" };
    const pub = await events(await worker.fetch(tryRequest(body), env, ctx));
    expect(pub[0]).toMatchObject({ type: "limited" });
    const vip = await events(await worker.fetch(tryRequest(body, { "x-care-desk-key": "vip-token-for-tests" }), env, ctx));
    await settle();
    expect(vip.some((e) => e.type === "done")).toBe(true);
    const wrong = await events(await worker.fetch(tryRequest(body, { "x-care-desk-key": "vip-token-for-testz" }), env, ctx));
    expect(wrong[0]).toMatchObject({ type: "limited" });
  });

  it("answers limited for everyone when the day's budget is spent", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const { env } = makeEnv({}, { [`spend:public:${day}`]: "3.2" });
    const { ctx } = makeCtx();
    const ev = await events(await worker.fetch(tryRequest({ personaId: "PT-1001", text: "hi" }), env, ctx));
    expect(ev[0]).toMatchObject({ type: "limited", reason: "daily" });
    if (ev[0].type === "limited") expect(ev[0].resetAt).toMatch(/T00:00:00\.000Z$/);
  });

  it("falls back to the labelled built-in stand-in for Claude when there is no key and no mock", async () => {
    const { env } = makeEnv({ MOCK: "0" });
    const { ctx, settle } = makeCtx();
    const ev = await events(await worker.fetch(tryRequest({ personaId: "PT-1001", text: "Has my order shipped?" }), env, ctx));
    await settle();
    const done = ev.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.result.mode).toBe("deterministic_only");
    expect(done.result.models.sort).toBe("mock");
    expect(done.result.usage.costUsd).toBe(0);
  });

  it("still stops a safety message at the rules with no key, before any stand-in runs", async () => {
    const { env } = makeEnv({ MOCK: "0" });
    const { ctx, settle } = makeCtx();
    const ev = await events(
      await worker.fetch(tryRequest({ personaId: "PT-1001", text: "The pain is killing me, it's been ages!" }), env, ctx),
    );
    await settle();
    const done = ev.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.result.route).not.toBe("draft");
    expect(done.result.draft).toBeUndefined();
    expect(done.result.trail.some((s) => s.status === "stopped")).toBe(true);
  });

  it("only accepts POST", async () => {
    const { env } = makeEnv();
    const { ctx } = makeCtx();
    const res = await worker.fetch(new Request("https://x/api/try"), env, ctx);
    expect(res.status).toBe(405);
  });
});

describe("worker /api/status", () => {
  it("needs the admin token", async () => {
    const { env } = makeEnv({ ADMIN_TOKEN: "admin-token-123" });
    const { ctx } = makeCtx();
    expect((await worker.fetch(new Request("https://x/api/status"), env, ctx)).status).toBe(401);
    const wrong = new Request("https://x/api/status", { headers: { authorization: "Bearer nope" } });
    expect((await worker.fetch(wrong, env, ctx)).status).toBe(401);
  });

  it("is closed when no admin token is configured", async () => {
    const { env } = makeEnv();
    const { ctx } = makeCtx();
    const req = new Request("https://x/api/status", { headers: { authorization: "Bearer " } });
    expect((await worker.fetch(req, env, ctx)).status).toBe(401);
  });

  it("reports today's spend, requests and limits per tier", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const { env } = makeEnv(
      { ADMIN_TOKEN: "admin-token-123" },
      { [`spend:public:${day}`]: "1.25", [`requests:public:${day}`]: "14", config: JSON.stringify({ dailyUsd: 5 }) },
    );
    const { ctx } = makeCtx();
    const res = await worker.fetch(new Request("https://x/api/status", { headers: { authorization: "Bearer admin-token-123" } }), env, ctx);
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.tiers.public).toMatchObject({ spentUsd: 1.25, requests: 14, dailyUsd: 5, remainingUsd: 3.75 });
    expect(s.tiers.vip).toMatchObject({ spentUsd: 0, dailyUsd: 10 });
  });
});

describe("worker routing", () => {
  it("answers unknown /api paths with 404 JSON", async () => {
    const { env } = makeEnv();
    const { ctx } = makeCtx();
    const res = await worker.fetch(new Request("https://x/api/nope"), env, ctx);
    expect(res.status).toBe(404);
  });
});

describe("worker segment files", () => {
  it("maps dotted segment prefetch names to the folders Next.js writes", async () => {
    const { segmentAssetPath } = await import("@/worker/index");
    expect(segmentAssetPath("/tests/__next.tests.__PAGE__.txt")).toBe("/tests/__next.tests/__PAGE__.txt");
    expect(segmentAssetPath("/dev/components/__next.dev.components.__PAGE__.txt")).toBe("/dev/components/__next.dev/components/__PAGE__.txt");
    expect(segmentAssetPath("/dev/components/__next.dev.components.txt")).toBe("/dev/components/__next.dev/components.txt");
    expect(segmentAssetPath("/tests/__next.tests.txt")).toBeUndefined();
    expect(segmentAssetPath("/tests/__next._tree.txt")).toBeUndefined();
    expect(segmentAssetPath("/__next.__PAGE__.txt")).toBeUndefined();
    expect(segmentAssetPath("/try/index.txt")).toBeUndefined();
  });

  it("serves the mapped file from the assets binding", async () => {
    const seen: string[] = [];
    const { env } = makeEnv({
      ASSETS: {
        async fetch(req: Request) {
          const p = new URL(req.url).pathname;
          seen.push(p);
          return p === "/tests/__next.tests/__PAGE__.txt" ? new Response("segment") : new Response("missing", { status: 404 });
        },
      },
    });
    const { ctx } = makeCtx();
    const res = await worker.fetch(new Request("https://x/tests/__next.tests.__PAGE__.txt?_rsc=abc"), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("segment");
    expect(seen[0]).toBe("/tests/__next.tests/__PAGE__.txt");
  });
});
