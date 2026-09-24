import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetDataCache, caseFile, dataUrl, loadData, peekData } from "@/lib/client/data";

afterEach(() => {
  _resetDataCache();
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("data loader", () => {
  it("builds root-absolute URLs that work under trailing-slash pages", () => {
    expect(dataUrl("queue.json")).toBe("/data/queue.json");
    expect(dataUrl(caseFile("MSG-0001"))).toBe("/data/cases/MSG-0001.json");
  });

  it("fetches once and caches", async () => {
    const fetch = stubFetch(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const [a, b] = await Promise.all([loadData("meta.json"), loadData("meta.json")]);
    expect(a).toEqual({ ok: 1 });
    expect(b).toBe(a);
    await loadData("meta.json");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(peekData("meta.json")).toEqual({ ok: 1 });
  });

  it("reports a missing file as not found, then retries on the next load", async () => {
    let status = 404;
    stubFetch(async () => new Response(status === 200 ? "[]" : "nope", { status }));
    await expect(loadData(caseFile("MSG-9999"))).rejects.toMatchObject({
      kind: "not_found",
      message: "This message could not be found.",
    });
    status = 200;
    await expect(loadData(caseFile("MSG-9999"))).resolves.toEqual([]);
  });

  it("reports network failures and unreadable JSON in plain words", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(loadData("queue.json")).rejects.toMatchObject({ kind: "network" });
    _resetDataCache();
    stubFetch(async () => new Response("{oops", { status: 200 }));
    await expect(loadData("queue.json")).rejects.toMatchObject({ kind: "bad_data" });
  });
});
