import { describe, expect, it } from "vitest";
import committed from "@/lib/fixtures/sample-results.json";
import { buildSamples } from "@/lib/fixtures/samples-build";

// The sample fixtures drive the welcome mini trail and the design review page. They must match what the current
// pipeline produces, or a trail could show sources, titles or summaries the real pipeline no longer gives.
describe("sample fixtures", () => {
  it("match a fresh run of the pipeline (regenerate: npx tsx lib/fixtures/build-samples.ts > lib/fixtures/sample-results.json)", async () => {
    const fresh = JSON.parse(JSON.stringify(await buildSamples()));
    expect(committed).toEqual(fresh);
  });

  it("never list the urgent safety protocol as a source for a routine reply", async () => {
    const routine = committed.cases.find((c) => c.key === "routine")!;
    const policy = (routine.result as { sources?: { policy: { id: string }[] } }).sources?.policy ?? [];
    expect(policy.map((p) => p.id).filter((id) => id.startsWith("P10."))).toEqual([]);
  });
});
