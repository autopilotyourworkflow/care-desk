/**
 * Node-only helper: reads KEY=VALUE pairs from .env.local and .env in the project root.
 * Real environment variables always win over the files. Never prints values.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./io";

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    out[m[1]] = value;
  }
  return out;
}

let cache: Record<string, string> | undefined;

/** Merged view: .env, then .env.local, then the real environment (highest priority). */
export function loadEnv(): Record<string, string> {
  if (cache) return cache;
  const merged: Record<string, string> = {
    ...parseEnvFile(join(ROOT, ".env")),
    ...parseEnvFile(join(ROOT, ".env.local")),
  };
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string" && v !== "") merged[k] = v;
  cache = merged;
  return merged;
}

export function getEnv(name: string): string | undefined {
  const v = loadEnv()[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function getApiKey(): string | undefined {
  return getEnv("ANTHROPIC_API_KEY");
}
