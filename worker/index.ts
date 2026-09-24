/**
 * Care Desk Worker. One Worker serves the static site from ./out (the assets binding answers every path except
 * /api/*, see wrangler.jsonc) and handles the API for the live "Try a message" box:
 *
 *   POST /api/try     run the pipeline on a visitor's message, streamed as newline-delimited JSON StepEvents. With no
 *                     key (or Claude unavailable) the labelled built-in stand-in for Claude sorts and drafts instead
 *   GET  /api/health  liveness and which features are configured (no secrets)
 *   GET  /api/status  today's spend, request counts and limits; needs Authorization: Bearer <ADMIN_TOKEN>
 *
 * Privacy: the message text is never logged or stored. KV holds only counters and amounts, keyed by a salted hourly
 * hash of IP + user agent. Every patient is fictional demo material.
 *
 * Env is written by hand (below) on purpose: the repo's single tsconfig also covers the Next.js app with the DOM lib,
 * and the global types `wrangler types` generates would clash with it. The binding types come from the module form
 * of @cloudflare/workers-types instead, and the shape matches wrangler.jsonc.
 */
import type { ExecutionContext, KVNamespace } from "@cloudflare/workers-types/index";
import patientsData from "@/data/patients.json";
import { MODEL_CONFIG, createClaudeClient, createMockClient, runPipeline, type LlmClient } from "@/lib/pipeline";
import type { Patient, PatientMessage, PipelineResult, StepEvent } from "@/lib/types";
import {
  CONFIG_KEY,
  bearer,
  decide,
  isVipToken,
  limitsFor,
  nextUtcHour,
  nextUtcMidnight,
  parseAmount,
  parseConfig,
  parseVipTokens,
  requestsKey,
  spendKey,
  ttlUntil,
  utcDay,
  utcHour,
  validateTryInput,
  visitorHash,
  visitorKey,
  constantTimeEqual,
  type LimitConfig,
  type Tier,
} from "./limits";
import { LIVE_BUDGET, SpendLedger, budgetClient, deadlineSignal } from "./budget";

export interface Env {
  /** Static assets from ./out. Only reached here for paths that are not /api/*, which should not happen. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
  CARE_DESK_KV: KVNamespace;
  /** "1" = the sample (mock) sorter and drafter, for local testing without a key. */
  MOCK?: string;
  ANTHROPIC_API_KEY?: string;
  /** Comma separated private-link tokens, sent by the page as X-Care-Desk-Key. */
  VIP_TOKENS?: string;
  ADMIN_TOKEN?: string;
  /** When unset, Turnstile is skipped. */
  TURNSTILE_SECRET?: string;
  /** Optional salt for the visitor hash. Falls back to a fixed string. */
  VISITOR_SALT?: string;
}

/** The three demo personas, from the fictional patient records. Immutable, so safe at module scope. */
const PERSONAS: ReadonlyMap<string, Patient> = new Map(
  (patientsData as Patient[]).filter((p) => p.demoPersona).map((p) => [p.id, p]),
);
const PERSONA_IDS: readonly string[] = Array.from(PERSONAS.keys());

const MAX_BODY_BYTES = 16_384;

const SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });
}

/** A single-event NDJSON answer (limits and validation), so the page reads every /api/try reply the same way. */
function ndjsonOnce(event: StepEvent, status = 200): Response {
  return new Response(JSON.stringify(event) + "\n", {
    status,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", ...SECURITY_HEADERS },
  });
}

/** Structured log line. Never pass the message text, the IP or the user agent. */
function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

async function readConfig(env: Env): Promise<LimitConfig> {
  try {
    return parseConfig(await env.CARE_DESK_KV.get(CONFIG_KEY));
  } catch {
    return parseConfig(null);
  }
}

async function readNumber(env: Env, key: string): Promise<number> {
  try {
    return parseAmount(await env.CARE_DESK_KV.get(key));
  } catch {
    return 0;
  }
}

/** Best-effort KV write: a failed counter write must never fail a visitor's try. */
async function writeNumber(env: Env, key: string, value: number, ttlSec: number): Promise<void> {
  try {
    await env.CARE_DESK_KV.put(key, String(value), { expirationTtl: ttlSec });
  } catch (err) {
    log("kv_write_failed", { key: key.split(":").slice(0, 2).join(":"), error: err instanceof Error ? err.message : "unknown" });
  }
}

async function verifyTurnstile(secret: string, token: string | undefined, ip: string): Promise<boolean> {
  if (!token) return false;
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

/** The real Claude client for the live box, or undefined when there is no key (or MOCK is on). */
function claudeFor(env: Env, cfg: LimitConfig): { sort: LlmClient; draft: LlmClient } | undefined {
  if (env.MOCK === "1" || !env.ANTHROPIC_API_KEY) return undefined;
  try {
    // Two clients, so the quick sort and the longer draft each get a timeout that suits them, with one retry at most.
    // Together with the run deadline (LIVE_BUDGET) the page always hears back before its own timeout.
    const models = { sortModel: cfg.sortModel, draftModel: cfg.draftModel, maxRetries: LIVE_BUDGET.maxRetries };
    return {
      sort: createClaudeClient(env.ANTHROPIC_API_KEY, { ...models, timeoutMs: LIVE_BUDGET.sortTimeoutMs }),
      draft: createClaudeClient(env.ANTHROPIC_API_KEY, { ...models, timeoutMs: LIVE_BUDGET.draftTimeoutMs }),
    };
  } catch {
    return undefined;
  }
}

async function handleTry(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const now = new Date();

  // ---- Input ----
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return ndjsonOnce({ type: "error", message: "That message is too long to run." }, 413);
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return ndjsonOnce({ type: "error", message: "That message is too long to run." }, 413);
    body = JSON.parse(raw);
  } catch {
    return ndjsonOnce({ type: "error", message: "Send a JSON body with personaId and text." }, 400);
  }
  const input = validateTryInput(body, PERSONA_IDS);
  if (!input.ok) return ndjsonOnce({ type: "error", message: input.message }, 400);
  const patient = PERSONAS.get(input.value.personaId);
  if (!patient) return ndjsonOnce({ type: "error", message: "Pick one of the three sample patients." }, 400);

  // ---- Who is asking ----
  const tier: Tier = isVipToken(request.headers.get("x-care-desk-key"), parseVipTokens(env.VIP_TOKENS)) ? "vip" : "public";
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ua = request.headers.get("user-agent") ?? "";

  // ---- Bot check (public only, and only when configured) ----
  if (tier === "public" && env.TURNSTILE_SECRET) {
    const human = await verifyTurnstile(env.TURNSTILE_SECRET, input.value.turnstileToken, ip);
    if (!human) {
      log("try_turnstile_failed", { tier });
      return ndjsonOnce({ type: "error", message: "We could not confirm you are a person. Reload the page and try again." }, 403);
    }
  }

  // ---- Limits ----
  const config = await readConfig(env);
  const day = utcDay(now);
  const hour = utcHour(now);
  const vHash = await visitorHash(ip, ua, env.VISITOR_SALT || "care-desk-visitor", hour);
  const vKey = visitorKey(tier, hour, vHash);
  const [spent, visitorCount, requests] = await Promise.all([
    readNumber(env, spendKey(tier, day)),
    readNumber(env, vKey),
    readNumber(env, requestsKey(tier, day)),
  ]);
  const decision = decide({ config, tier, spentUsd: spent, visitorCount, now });
  if (!decision.ok) {
    log("try_limited", { tier, reason: decision.reason });
    return ndjsonOnce({ type: "limited", reason: decision.reason, resetAt: decision.resetAt });
  }
  // Count the try up front, so a burst of parallel requests cannot all slip under the hourly limit.
  const dayTtl = ttlUntil(nextUtcMidnight(now), now);
  await Promise.all([
    writeNumber(env, vKey, visitorCount + 1, ttlUntil(nextUtcHour(now), now, 120)),
    writeNumber(env, requestsKey(tier, day), requests + 1, dayTtl),
  ]);

  // ---- Run, streaming every step as it happens ----
  const message: PatientMessage = {
    id: `LIVE-${crypto.randomUUID().slice(0, 8)}`,
    patientId: patient.id,
    channel: "chat",
    receivedAt: now.toISOString(),
    body: input.value.text,
  };
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (e: StepEvent): Promise<void> => writer.write(enc.encode(JSON.stringify(e) + "\n")).catch(() => {});

  // Stop starting (and stop waiting for) Claude calls at the run deadline, or as soon as the visitor's page goes away.
  const deadline = deadlineSignal(LIVE_BUDGET.runDeadlineMs, request.signal);
  // Every call books an estimate before it starts and its real cost when it settles, so a run cut short still counts.
  const ledger = new SpendLedger(
    { read: () => readNumber(env, spendKey(tier, day)), write: (total) => writeNumber(env, spendKey(tier, day), total, dayTtl) },
    spent,
  );
  const claude = claudeFor(env, config);
  const budgeted = claude
    ? budgetClient(
        { sort: (i) => claude.sort.sort(i), draft: (i) => claude.draft.draft(i) },
        {
          signal: deadline,
          ledger,
          sortModel: config.sortModel || MODEL_CONFIG.sortModel,
          draftModel: config.draftModel || MODEL_CONFIG.draftModel,
        },
      )
    : undefined;
  const llm: LlmClient | undefined = env.MOCK === "1" ? createMockClient() : budgeted?.client;

  const run = async () => {
    const started = Date.now();
    let result: PipelineResult | undefined;
    try {
      result = await runPipeline(message, patient, {
        llm,
        mode: llm ? "live" : "deterministic_only",
        // No key, Claude unavailable or out of time: the labelled built-in stand-in still sorts and drafts, so a routine
        // message ends in a checked sample reply instead of a dead end. The page labels it; the safety rules run first.
        fallbackLlm: createMockClient(),
        onStep: (step) => void send({ type: "step", step }),
      });
      await send({ type: "done", result });
    } catch (err) {
      log("try_failed", { tier, error: err instanceof Error ? err.name : "unknown" });
      await send({ type: "error", message: "Something went wrong while running the checks." });
    } finally {
      await writer.close().catch(() => {});
    }
    const cutShort = deadline.aborted;
    // Let any abandoned call settle, so its estimate is swapped for the real cost, within what waitUntil allows.
    await budgeted?.drain(LIVE_BUDGET.draftTimeoutMs);
    await ledger.settled();
    log("try_done", {
      tier,
      persona: patient.id,
      route: result?.route,
      mode: result?.mode,
      models: result?.models,
      costUsd: budgeted?.bookedUsd() ?? 0,
      cutShort,
      ms: Date.now() - started,
      chars: input.value.text.length,
    });
  };
  ctx.waitUntil(run());

  return new Response(readable, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", ...SECURITY_HEADERS },
  });
}

async function handleStatus(request: Request, env: Env): Promise<Response> {
  const admin = env.ADMIN_TOKEN ?? "";
  const given = bearer(request.headers.get("authorization"));
  if (!admin || !given || !constantTimeEqual(given, admin)) {
    return json({ error: "Not authorised." }, 401, { "www-authenticate": "Bearer" });
  }
  const now = new Date();
  const day = utcDay(now);
  const config = await readConfig(env);
  const tiers = await Promise.all(
    (["public", "vip"] as const).map(async (tier) => {
      const [spentUsd, requests] = await Promise.all([
        readNumber(env, spendKey(tier, day)),
        readNumber(env, requestsKey(tier, day)),
      ]);
      const lim = limitsFor(config, tier);
      return [tier, { spentUsd, requests, dailyUsd: lim.dailyUsd, perVisitorPerHour: lim.perHour, remainingUsd: Math.max(0, Math.round((lim.dailyUsd - spentUsd) * 1e6) / 1e6) }] as const;
    }),
  );
  return json({
    day,
    now: now.toISOString(),
    resetsAt: nextUtcMidnight(now),
    enabled: config.enabled,
    models: { sort: config.sortModel ?? "default", draft: config.draftModel ?? "default" },
    mock: env.MOCK === "1",
    ai: env.MOCK === "1" || Boolean(env.ANTHROPIC_API_KEY),
    vipTokens: parseVipTokens(env.VIP_TOKENS).length,
    tiers: Object.fromEntries(tiers),
  });
}

/**
 * Next.js static export writes route segment files as folders ("tests/__next.tests/__PAGE__.txt") while the client
 * prefetches them with dots ("tests/__next.tests.__PAGE__.txt"). Map the dotted name to the file on disk, so client
 * navigation gets its segment data instead of a 404. Returns undefined when the path is not a segment file.
 */
export function segmentAssetPath(pathname: string): string | undefined {
  const m = /^(.*\/)__next\.([^/]+)\.txt$/.exec(pathname);
  if (!m) return undefined;
  const mapped = `${m[1]}__next.${m[2].split(".").join("/")}.txt`;
  return mapped === pathname ? undefined : mapped;
}

async function serveAsset(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ASSETS) return json({ error: "Not found." }, 404);
  const mapped = segmentAssetPath(url.pathname);
  if (mapped && (request.method === "GET" || request.method === "HEAD")) {
    const res = await env.ASSETS.fetch(new Request(new URL(mapped + url.search, url), request));
    if (res.status !== 404) return res;
  }
  return env.ASSETS.fetch(request);
}

function handleHealth(env: Env): Response {
  return json({
    ok: true,
    ai: env.MOCK === "1" || Boolean(env.ANTHROPIC_API_KEY),
    mock: env.MOCK === "1",
    turnstile: Boolean(env.TURNSTILE_SECRET),
  });
}

const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/api/try") {
        if (request.method !== "POST") return json({ error: "Use POST." }, 405, { allow: "POST" });
        return await handleTry(request, env, ctx);
      }
      if (path === "/api/health") {
        if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Use GET." }, 405, { allow: "GET" });
        return handleHealth(env);
      }
      if (path === "/api/status") {
        if (request.method !== "GET") return json({ error: "Use GET." }, 405, { allow: "GET" });
        return await handleStatus(request, env);
      }
      if (path.startsWith("/api/") || path === "/api") return json({ error: "Not found." }, 404);
      return await serveAsset(request, env, url);
    } catch (err) {
      log("unhandled", { path, error: err instanceof Error ? err.name : "unknown" });
      return json({ error: "Something went wrong." }, 500);
    }
  },
};

export default handler;
