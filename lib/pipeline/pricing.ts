/**
 * Claude API prices in US dollars per million tokens.
 *
 * Source: the claude-api skill's "Current Models" table (cached 2026-06-24), Anthropic first-party rates.
 * Cache writes (5 minute TTL) cost 1.25x the input rate; cache reads cost 0.1x the input rate, except where the skill
 * lists a model-specific cache-read price (Claude Opus 5.5: $0.20, Claude Fable 5.1: $0.25).
 *
 * Runs in Node, the browser and a Cloudflare Worker: no Node-only APIs.
 */

export interface ModelPrice {
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million output tokens (thinking tokens bill as output). */
  output: number;
  /** USD per million tokens written to the prompt cache. */
  cacheWrite: number;
  /** USD per million tokens read from the prompt cache. */
  cacheRead: number;
}

function price(input: number, output: number, cacheRead = input * 0.1): ModelPrice {
  return { input, output, cacheWrite: input * 1.25, cacheRead };
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": price(1, 5),
  "claude-sonnet-5": price(2, 10),
  "claude-sonnet-4-6": price(3, 15),
  "claude-opus-5": price(5, 25),
  "claude-opus-5-5": price(4, 20, 0.2),
  "claude-opus-4-8": price(5, 25),
  "claude-opus-4-7": price(5, 25),
  "claude-opus-4-6": price(5, 25),
  "claude-fable-5": price(10, 50),
  "claude-fable-5-1": price(10, 50, 0.25),
  mock: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
};

/**
 * Used for any model id not in the table. Deliberately the most expensive tier, so a spend cap computed from these
 * figures errs on the side of stopping early rather than overspending.
 */
export const UNKNOWN_MODEL_PRICE: ModelPrice = price(10, 50, 1);

/** Token counts as the API reports them. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

/** Strips a dated snapshot suffix ("claude-haiku-4-5-20251001" to "claude-haiku-4-5"). */
export function baseModelId(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

export function priceFor(model: string): ModelPrice {
  if (model.startsWith("mock")) return PRICES.mock;
  return PRICES[baseModelId(model)] ?? UNKNOWN_MODEL_PRICE;
}

/** Cost of one request in USD. */
export function costUsd(model: string, usage: TokenUsage): number {
  const p = priceFor(model);
  const total =
    usage.inputTokens * p.input +
    usage.outputTokens * p.output +
    (usage.cacheWriteTokens ?? 0) * p.cacheWrite +
    (usage.cacheReadTokens ?? 0) * p.cacheRead;
  return total / 1_000_000;
}
