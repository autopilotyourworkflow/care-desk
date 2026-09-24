import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  LIMIT_CEILINGS,
  MAX_TEXT,
  addSpend,
  bearer,
  constantTimeEqual,
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
} from "@/worker/limits";

const NOW = new Date("2026-09-23T14:25:10.000Z");
const PERSONAS = ["PT-1001", "PT-1031", "PT-1043"];

describe("parseConfig", () => {
  it("uses the safe defaults when nothing is stored", () => {
    expect(parseConfig(null)).toEqual({ ...DEFAULT_LIMITS });
    expect(parseConfig(undefined)).toEqual({ ...DEFAULT_LIMITS });
    expect(parseConfig("")).toEqual({ ...DEFAULT_LIMITS });
  });

  it("has the agreed defaults", () => {
    expect(DEFAULT_LIMITS).toEqual({ enabled: true, dailyUsd: 3, perVisitorPerHour: 10, vipDailyUsd: 10, vipPerVisitorPerHour: 60 });
  });

  it("falls back to the defaults for broken JSON or a non-object", () => {
    expect(parseConfig("{nope")).toEqual({ ...DEFAULT_LIMITS });
    expect(parseConfig("[1,2]")).toEqual({ ...DEFAULT_LIMITS });
    expect(parseConfig("42")).toEqual({ ...DEFAULT_LIMITS });
  });

  it("merges valid fields over the defaults", () => {
    const c = parseConfig(JSON.stringify({ dailyUsd: 5, perVisitorPerHour: 20 }));
    expect(c.dailyUsd).toBe(5);
    expect(c.perVisitorPerHour).toBe(20);
    expect(c.vipDailyUsd).toBe(10);
    expect(c.enabled).toBe(true);
  });

  it("accepts numbers written as strings", () => {
    expect(parseConfig(JSON.stringify({ dailyUsd: "7.5" })).dailyUsd).toBe(7.5);
  });

  it("ignores negative, non-finite and wrong-typed values field by field", () => {
    const c = parseConfig(JSON.stringify({ dailyUsd: -1, perVisitorPerHour: "lots", vipDailyUsd: null, enabled: "no" }));
    expect(c).toEqual({ ...DEFAULT_LIMITS });
  });

  it("caps values at the hard ceilings", () => {
    const c = parseConfig(JSON.stringify({ dailyUsd: 30000, perVisitorPerHour: 999999, vipDailyUsd: 1e9 }));
    expect(c.dailyUsd).toBe(LIMIT_CEILINGS.usd);
    expect(c.vipDailyUsd).toBe(LIMIT_CEILINGS.usd);
    expect(c.perVisitorPerHour).toBe(LIMIT_CEILINGS.perHour);
  });

  it("floors hourly counts to whole numbers", () => {
    expect(parseConfig(JSON.stringify({ perVisitorPerHour: 2.9 })).perVisitorPerHour).toBe(2);
  });

  it("can switch the live box off", () => {
    expect(parseConfig(JSON.stringify({ enabled: false })).enabled).toBe(false);
  });

  it("keeps plausible model overrides and drops anything else", () => {
    const c = parseConfig(JSON.stringify({ sortModel: "claude-haiku-4-5", draftModel: "claude-sonnet-5" }));
    expect(c.sortModel).toBe("claude-haiku-4-5");
    expect(c.draftModel).toBe("claude-sonnet-5");
    const bad = parseConfig(JSON.stringify({ sortModel: "x", draftModel: "rm -rf /" }));
    expect(bad.sortModel).toBeUndefined();
    expect(bad.draftModel).toBeUndefined();
  });
});

describe("limitsFor", () => {
  it("gives each tier its own budget", () => {
    expect(limitsFor(DEFAULT_LIMITS, "public")).toEqual({ dailyUsd: 3, perHour: 10 });
    expect(limitsFor(DEFAULT_LIMITS, "vip")).toEqual({ dailyUsd: 10, perHour: 60 });
  });
});

describe("time windows", () => {
  it("names the UTC day and hour", () => {
    expect(utcDay(NOW)).toBe("2026-09-23");
    expect(utcHour(NOW)).toBe("2026-09-23T14");
  });

  it("resets the day at the next UTC midnight, across month and year ends", () => {
    expect(nextUtcMidnight(NOW)).toBe("2026-09-24T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-09-30T23:59:59Z"))).toBe("2026-10-01T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-12-31T12:00:00Z"))).toBe("2027-01-01T00:00:00.000Z");
  });

  it("resets the visitor count at the next UTC hour", () => {
    expect(nextUtcHour(NOW)).toBe("2026-09-23T15:00:00.000Z");
    expect(nextUtcHour(new Date("2026-09-23T23:30:00Z"))).toBe("2026-09-24T00:00:00.000Z");
  });

  it("gives keys a TTL that outlasts the window, never under KV's 60 second minimum", () => {
    expect(ttlUntil(nextUtcHour(NOW), NOW, 0)).toBe(2090);
    expect(ttlUntil(nextUtcHour(NOW), NOW, 120)).toBe(2210);
    expect(ttlUntil(NOW.toISOString(), NOW, 0)).toBe(60);
  });
});

describe("keys and amounts", () => {
  it("keeps tiers apart in every key", () => {
    expect(spendKey("public", "2026-09-23")).toBe("spend:public:2026-09-23");
    expect(spendKey("vip", "2026-09-23")).toBe("spend:vip:2026-09-23");
    expect(requestsKey("vip", "2026-09-23")).toBe("requests:vip:2026-09-23");
    expect(visitorKey("public", "2026-09-23T14", "abc")).toBe("visitor:public:2026-09-23T14:abc");
    expect(visitorKey("public", "h", "abc")).not.toBe(visitorKey("vip", "h", "abc"));
  });

  it("reads unreadable stored values as zero", () => {
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount("abc")).toBe(0);
    expect(parseAmount("-3")).toBe(0);
    expect(parseAmount("1.25")).toBe(1.25);
  });

  it("adds spend without float drift and ignores bad costs", () => {
    let total = 0;
    for (let i = 0; i < 10; i++) total = addSpend(total, 0.1);
    expect(total).toBe(1);
    expect(addSpend(1, Number.NaN)).toBe(1);
    expect(addSpend(1, -5)).toBe(1);
    expect(addSpend(0.000001, 0.0000004)).toBe(0.000001);
  });
});

describe("decide", () => {
  const base = { config: parseConfig(null), tier: "public" as const, spentUsd: 0, visitorCount: 0, now: NOW };

  it("allows a try under both limits", () => {
    expect(decide(base)).toEqual({ ok: true });
  });

  it("allows the last try in the hour and limits the next one", () => {
    expect(decide({ ...base, visitorCount: 9 })).toEqual({ ok: true });
    expect(decide({ ...base, visitorCount: 10 })).toEqual({ ok: false, reason: "visitor", resetAt: "2026-09-23T15:00:00.000Z" });
  });

  it("stops everyone in the tier once the day's budget is spent, until midnight UTC", () => {
    expect(decide({ ...base, spentUsd: 2.999 })).toEqual({ ok: true });
    expect(decide({ ...base, spentUsd: 3 })).toEqual({ ok: false, reason: "daily", resetAt: "2026-09-24T00:00:00.000Z" });
  });

  it("reports the daily limit first when both are reached", () => {
    const d = decide({ ...base, spentUsd: 5, visitorCount: 50 });
    expect(d.ok === false && d.reason).toBe("daily");
  });

  it("gives VIP links their own, larger allowance", () => {
    expect(decide({ ...base, tier: "vip", spentUsd: 5, visitorCount: 30 })).toEqual({ ok: true });
    expect(decide({ ...base, tier: "vip", visitorCount: 60 })).toMatchObject({ ok: false, reason: "visitor" });
    expect(decide({ ...base, tier: "vip", spentUsd: 10 })).toMatchObject({ ok: false, reason: "daily" });
  });

  it("answers limited when the box is switched off or a limit is zero", () => {
    expect(decide({ ...base, config: parseConfig('{"enabled":false}') })).toMatchObject({ ok: false, reason: "daily" });
    expect(decide({ ...base, config: parseConfig('{"dailyUsd":0}') })).toMatchObject({ ok: false, reason: "daily" });
    expect(decide({ ...base, config: parseConfig('{"perVisitorPerHour":0}') })).toMatchObject({ ok: false, reason: "visitor" });
  });

  it("respects a tiny limit set in KV", () => {
    const config = parseConfig('{"perVisitorPerHour":2}');
    expect(decide({ ...base, config, visitorCount: 1 }).ok).toBe(true);
    expect(decide({ ...base, config, visitorCount: 2 }).ok).toBe(false);
  });
});

describe("VIP tokens and secrets", () => {
  it("parses a comma separated list, dropping blanks, duplicates and short tokens", () => {
    expect(parseVipTokens("abcdefghijkl, mnopqrstuvwx ,,short,abcdefghijkl")).toEqual(["abcdefghijkl", "mnopqrstuvwx"]);
    expect(parseVipTokens(undefined)).toEqual([]);
    expect(parseVipTokens("")).toEqual([]);
  });

  it("matches a header only against a listed token", () => {
    const tokens = ["abcdefghijkl", "mnopqrstuvwx"];
    expect(isVipToken("mnopqrstuvwx", tokens)).toBe(true);
    expect(isVipToken(" abcdefghijkl ", tokens)).toBe(true);
    expect(isVipToken("abcdefghijk", tokens)).toBe(false);
    expect(isVipToken("abcdefghijklm", tokens)).toBe(false);
    expect(isVipToken("", tokens)).toBe(false);
    expect(isVipToken(null, tokens)).toBe(false);
    expect(isVipToken("abcdefghijkl", [])).toBe(false);
  });

  it("compares strings of any length safely", () => {
    expect(constantTimeEqual("same-value", "same-value")).toBe(true);
    expect(constantTimeEqual("same-value", "same-valuf")).toBe(false);
    expect(constantTimeEqual("short", "shorter")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("reads a bearer token", () => {
    expect(bearer("Bearer abc123")).toBe("abc123");
    expect(bearer("bearer   abc123 ")).toBe("abc123");
    expect(bearer("abc123")).toBe("abc123");
    expect(bearer(null)).toBe("");
  });
});

describe("visitorHash", () => {
  it("is stable within an hour and changes with the hour, the salt, the IP and the user agent", async () => {
    const a = await visitorHash("203.0.113.9", "Mozilla/5.0", "salt", "2026-09-23T14");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await visitorHash("203.0.113.9", "Mozilla/5.0", "salt", "2026-09-23T14")).toBe(a);
    expect(await visitorHash("203.0.113.9", "Mozilla/5.0", "salt", "2026-09-23T15")).not.toBe(a);
    expect(await visitorHash("203.0.113.9", "Mozilla/5.0", "other", "2026-09-23T14")).not.toBe(a);
    expect(await visitorHash("203.0.113.10", "Mozilla/5.0", "salt", "2026-09-23T14")).not.toBe(a);
    expect(await visitorHash("203.0.113.9", "Safari", "salt", "2026-09-23T14")).not.toBe(a);
  });

  it("never contains the raw IP", async () => {
    expect(await visitorHash("203.0.113.9", "ua", "s", "h")).not.toContain("203");
  });
});

describe("validateTryInput", () => {
  it("accepts a persona and a message, trimmed", () => {
    expect(validateTryInput({ personaId: "PT-1031", text: "  Where is my order?  " }, PERSONAS)).toEqual({
      ok: true,
      value: { personaId: "PT-1031", text: "Where is my order?" },
    });
  });

  it("keeps a Turnstile token when one is sent", () => {
    const v = validateTryInput({ personaId: "PT-1001", text: "hi", turnstileToken: "tok" }, PERSONAS);
    expect(v.ok && v.value.turnstileToken).toBe("tok");
  });

  it("rejects an unknown persona", () => {
    expect(validateTryInput({ personaId: "PT-1002", text: "hi" }, PERSONAS)).toMatchObject({ ok: false });
    expect(validateTryInput({ text: "hi" }, PERSONAS)).toMatchObject({ ok: false });
  });

  it("rejects an empty or whitespace-only message", () => {
    expect(validateTryInput({ personaId: "PT-1001", text: "" }, PERSONAS)).toMatchObject({ ok: false });
    expect(validateTryInput({ personaId: "PT-1001", text: "   \n " }, PERSONAS)).toMatchObject({ ok: false });
    expect(validateTryInput({ personaId: "PT-1001", text: 42 }, PERSONAS)).toMatchObject({ ok: false });
  });

  it("accepts exactly 1,200 characters and rejects 1,201", () => {
    expect(validateTryInput({ personaId: "PT-1001", text: "a".repeat(MAX_TEXT) }, PERSONAS).ok).toBe(true);
    expect(validateTryInput({ personaId: "PT-1001", text: "a".repeat(MAX_TEXT + 1) }, PERSONAS).ok).toBe(false);
  });

  it("rejects a body that is not an object", () => {
    expect(validateTryInput(null, PERSONAS).ok).toBe(false);
    expect(validateTryInput("hi", PERSONAS).ok).toBe(false);
    expect(validateTryInput([], PERSONAS).ok).toBe(false);
  });

  it("uses no dashes in its messages", () => {
    const msgs = [
      validateTryInput(null, PERSONAS),
      validateTryInput({ personaId: "x", text: "hi" }, PERSONAS),
      validateTryInput({ personaId: "PT-1001", text: "" }, PERSONAS),
      validateTryInput({ personaId: "PT-1001", text: "a".repeat(2000) }, PERSONAS),
    ];
    const dash = new RegExp("[\\u2013\\u2014]");
    for (const m of msgs) expect(m.ok === false && dash.test(m.message)).toBe(false);
  });
});
