import { describe, it, expect } from "vitest";
import { ROUTINE_CATEGORIES, SAFETY_CATEGORIES } from "@/lib/types";

describe("contract", () => {
  it("keeps routine and safety categories disjoint", () => {
    const r = new Set<string>(ROUTINE_CATEGORIES);
    expect(SAFETY_CATEGORIES.some((c) => r.has(c))).toBe(false);
  });
});
