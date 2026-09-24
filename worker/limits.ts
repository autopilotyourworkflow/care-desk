/**
 * Limits for the live "Try a message" box, as pure functions (no I/O), so every rule is unit tested.
 * The Worker (worker/index.ts) reads and writes KV; this file only decides.
 *
 * Two tiers with separate budgets, so public traffic can never use up a private (VIP) link's allowance:
 *   public  dailyUsd 3,  perVisitorPerHour 10
 *   vip     vipDailyUsd 10, vipPerVisitorPerHour 60
 * Spend is counted per UTC day from each result's usage.costUsd. Visitors are counted per UTC hour by a salted hash
 * of IP + user agent; the hour is part of the hash, so a visitor cannot be followed from one hour to the next.
 * Runs in a Cloudflare Worker and in Node (Vitest): Web Crypto only, no Node-only APIs.
 */

export type Tier = "public" | "vip";

export interface LimitConfig {
  /** Master switch. false = every try answers "limited" and the page runs the rules in the browser. */
  enabled: boolean;
  dailyUsd: number;
  perVisitorPerHour: number;
  vipDailyUsd: number;
  vipPerVisitorPerHour: number;
  /** Optional model overrides passed to createClaudeClient. */
  sortModel?: string;
  draftModel?: string;
}

export const DEFAULT_LIMITS: Readonly<LimitConfig> = Object.freeze({
  enabled: true,
  dailyUsd: 3,
  perVisitorPerHour: 10,
  vipDailyUsd: 10,
  vipPerVisitorPerHour: 60,
});

/** Hard ceilings, so a typo in the KV config (an extra zero) cannot run up a large bill. */
export const LIMIT_CEILINGS = Object.freeze({ usd: 200, perHour: 1000 });

export const MAX_TEXT = 1200;

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;

function num(v: unknown, fallback: number, max: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function int(v: unknown, fallback: number, max: number): number {
  return Math.floor(num(v, fallback, max));
}

/**
 * The KV "config" value, merged over the safe defaults. Anything missing, malformed or out of range falls back to
 * the default for that field, so a broken config never switches the limits off.
 */
export function parseConfig(raw: string | null | undefined): LimitConfig {
  const base: LimitConfig = { ...DEFAULT_LIMITS };
  if (!raw) return base;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return base;
  const o = v as Record<string, unknown>;
  const cfg: LimitConfig = {
    enabled: typeof o.enabled === "boolean" ? o.enabled : base.enabled,
    dailyUsd: num(o.dailyUsd, base.dailyUsd, LIMIT_CEILINGS.usd),
    perVisitorPerHour: int(o.perVisitorPerHour, base.perVisitorPerHour, LIMIT_CEILINGS.perHour),
    vipDailyUsd: num(o.vipDailyUsd, base.vipDailyUsd, LIMIT_CEILINGS.usd),
    vipPerVisitorPerHour: int(o.vipPerVisitorPerHour, base.vipPerVisitorPerHour, LIMIT_CEILINGS.perHour),
  };
  if (typeof o.sortModel === "string" && MODEL_ID.test(o.sortModel)) cfg.sortModel = o.sortModel;
  if (typeof o.draftModel === "string" && MODEL_ID.test(o.draftModel)) cfg.draftModel = o.draftModel;
  return cfg;
}

export function limitsFor(cfg: LimitConfig, tier: Tier): { dailyUsd: number; perHour: number } {
  return tier === "vip"
    ? { dailyUsd: cfg.vipDailyUsd, perHour: cfg.vipPerVisitorPerHour }
    : { dailyUsd: cfg.dailyUsd, perHour: cfg.perVisitorPerHour };
}

// ---------- Time windows (UTC) ----------

/** "2026-09-23" */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** "2026-09-23T14" */
export function utcHour(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/** The next UTC midnight, as an ISO string: when the daily budget resets. */
export function nextUtcMidnight(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return d.toISOString();
}

/** The start of the next UTC hour: when a visitor's hourly count resets. */
export function nextUtcHour(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1));
  return d.toISOString();
}

/** Seconds a key must live to outlast its window, with KV's 60 second minimum and a margin. */
export function ttlUntil(resetAtIso: string, now: Date, marginSec = 3600): number {
  const secs = Math.ceil((Date.parse(resetAtIso) - now.getTime()) / 1000);
  return Math.max(60, secs + marginSec);
}

// ---------- KV keys ----------

export const CONFIG_KEY = "config";

export function spendKey(tier: Tier, day: string): string {
  return `spend:${tier}:${day}`;
}

export function requestsKey(tier: Tier, day: string): string {
  return `requests:${tier}:${day}`;
}

export function visitorKey(tier: Tier, hour: string, visitorHash: string): string {
  return `visitor:${tier}:${hour}:${visitorHash}`;
}

/** A stored counter or amount. Anything unreadable counts as 0. */
export function parseAmount(raw: string | null | undefined): number {
  const n = raw == null ? 0 : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Adds a cost to the day's spend, rounded to a millionth of a dollar so floats do not drift. */
export function addSpend(current: number, costUsd: number): number {
  const add = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
  return Math.round((current + add) * 1e6) / 1e6;
}

// ---------- The decision ----------

export type Decision = { ok: true } | { ok: false; reason: "visitor" | "daily"; resetAt: string };

/**
 * Whether one more try is allowed, given what KV holds before this request.
 *   spentUsd      the tier's spend so far today (UTC)
 *   visitorCount  this visitor's tries so far this hour, not counting this one
 * The daily budget is checked first: when it is spent, everyone in the tier waits for midnight UTC.
 */
export function decide(input: {
  config: LimitConfig;
  tier: Tier;
  spentUsd: number;
  visitorCount: number;
  now: Date;
}): Decision {
  const { config, tier, spentUsd, visitorCount, now } = input;
  if (!config.enabled) return { ok: false, reason: "daily", resetAt: nextUtcMidnight(now) };
  const lim = limitsFor(config, tier);
  if (lim.dailyUsd <= 0 || spentUsd >= lim.dailyUsd) return { ok: false, reason: "daily", resetAt: nextUtcMidnight(now) };
  if (lim.perHour <= 0 || visitorCount >= lim.perHour) return { ok: false, reason: "visitor", resetAt: nextUtcHour(now) };
  return { ok: true };
}

// ---------- VIP tokens and secrets ----------

/** VIP_TOKENS is a comma separated list. Blanks and very short tokens (under 12 characters) are ignored. */
export function parseVipTokens(secret: string | null | undefined): string[] {
  if (!secret) return [];
  return Array.from(
    new Set(
      secret
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length >= 12 && t.length <= 256),
    ),
  );
}

/** Constant-time comparison of two strings of any length (the length difference is folded into the result). */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** True when the header value matches one of the VIP tokens. Every token is compared, so timing does not leak which. */
export function isVipToken(header: string | null | undefined, tokens: string[]): boolean {
  const given = (header ?? "").trim();
  if (!given || tokens.length === 0) return false;
  let match = false;
  for (const t of tokens) if (constantTimeEqual(given, t)) match = true;
  return match;
}

/** Bearer token from an Authorization header, else the raw value. */
export function bearer(header: string | null | undefined): string {
  const h = (header ?? "").trim();
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return (m ? m[1] : h).trim();
}

// ---------- Visitor hash ----------

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A salted SHA-256 of IP + user agent for this hour, cut to 32 hex characters. The raw IP and user agent are never
 * stored; the hour is part of the input, so hashes from different hours cannot be linked.
 */
export async function visitorHash(ip: string, userAgent: string, salt: string, hour: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}\u0000${hour}\u0000${ip}\u0000${userAgent.slice(0, 512)}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hex(digest).slice(0, 32);
}

// ---------- Input validation ----------

export type TryInput = { personaId: string; text: string; turnstileToken?: string };

export type Validation = { ok: true; value: TryInput } | { ok: false; message: string };

/**
 * The POST /api/try body: { personaId, text, turnstileToken? }. The persona must be one of the three demo patients,
 * the text 1 to 1,200 characters after trimming. Messages name the problem and the fix.
 */
export function validateTryInput(body: unknown, personaIds: readonly string[]): Validation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Send a JSON body with personaId and text." };
  }
  const o = body as Record<string, unknown>;
  const personaId = typeof o.personaId === "string" ? o.personaId.trim() : "";
  if (!personaIds.includes(personaId)) {
    return { ok: false, message: "Pick one of the three sample patients." };
  }
  if (typeof o.text !== "string") return { ok: false, message: "Type a message to run." };
  const text = o.text.replace(/\r\n?/g, "\n").trim();
  if (text.length === 0) return { ok: false, message: "Type a message to run." };
  if ([...text].length > MAX_TEXT) {
    return { ok: false, message: `Keep the message to ${MAX_TEXT.toLocaleString("en-AU")} characters or fewer.` };
  }
  const value: TryInput = { personaId, text };
  if (typeof o.turnstileToken === "string" && o.turnstileToken.length > 0 && o.turnstileToken.length <= 4096) {
    value.turnstileToken = o.turnstileToken;
  }
  return { ok: true, value };
}
