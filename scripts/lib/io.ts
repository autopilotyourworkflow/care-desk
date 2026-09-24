/**
 * Node-only file helpers for the scripts. Scripts are run from the project root (npm run ...).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const ROOT = process.cwd();

export function dataPath(name: string): string {
  return join(ROOT, "data", name);
}

export function readJsonFile<T>(path: string): T {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  return JSON.parse(text) as T;
}

export function readJsonIfExists<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readJsonFile<T>(path);
  } catch {
    return undefined;
  }
}

/** Writes pretty JSON atomically (temp file, then rename), so an interrupted run never leaves half a file. */
export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/**
 * Data files may be a bare array or an object wrapping one (for example { "messages": [...] }).
 * Returns the array either way.
 */
export function asArray<T>(value: unknown, preferredKey: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj[preferredKey])) return obj[preferredKey] as T[];
    const first = Object.values(obj).find(Array.isArray);
    if (first) return first as T[];
  }
  throw new Error(`Expected an array (or an object with "${preferredKey}")`);
}

export function requireFile(path: string, hint: string): void {
  if (!existsSync(path)) {
    console.error(`Missing ${path}. ${hint}`);
    process.exit(1);
  }
}
