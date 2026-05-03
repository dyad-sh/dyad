/**
 * IpfsPinner — provider-fallback unit tests.
 *
 * Strategy: inject a mocked `fetch` and a mocked `heliaLoader` so we can
 * verify the pinner walks the provider order (4everland → Pinata → Helia)
 * without any network calls and without spinning up a real IPFS node.
 */

import { describe, it, expect, vi } from "vitest";

// Avoid pulling in electron-log's main-process side effects in the unit test
// runner. The pinner only uses .info / .warn so a stub is fine.
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) },
}));

import { IpfsPinner } from "@/lib/joymarketplace/ipfs_pinner";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("IpfsPinner", () => {
  it("uses 4everland first when its key is configured", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith("https://api.4everland.dev")) {
        return jsonResponse({ cid: "bafy4ever" });
      }
      throw new Error(`unexpected ${u}`);
    });

    const pinner = new IpfsPinner({
      keys: { foureverland: { apiKey: "k1" }, pinata: { jwt: "j" } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const r = await pinner.pinJson({ hello: "world" }, "meta");
    expect(r.provider).toBe("4everland");
    expect(r.cid).toBe("bafy4ever");
    expect(r.pinnedRemotely).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Pinata when 4everland fails", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith("https://api.4everland.dev")) {
        return jsonResponse({ error: "boom" }, false, 500);
      }
      if (u.startsWith("https://api.pinata.cloud")) {
        return jsonResponse({ IpfsHash: "bafyPin", PinSize: 42 });
      }
      throw new Error(`unexpected ${u}`);
    });

    const pinner = new IpfsPinner({
      keys: { foureverland: { apiKey: "k1" }, pinata: { jwt: "j" } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const r = await pinner.pinJson({ a: 1 });
    expect(r.provider).toBe("pinata");
    expect(r.cid).toBe("bafyPin");
    expect(r.pinnedRemotely).toBe(true);
    // Two attempts: 4everland (fail), then Pinata (success)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to local Helia (pinnedRemotely=false) when no remote keys are present", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network not allowed in this test");
    });
    const heliaLoader = vi.fn(async () => ({
      add: async () => ({ cid: "bafyHelia" }),
    }));

    const pinner = new IpfsPinner({
      keys: {},
      fetchImpl: fetchMock as unknown as typeof fetch,
      heliaLoader,
    });

    const r = await pinner.pinJson({ a: 1 });
    expect(r.provider).toBe("helia");
    expect(r.cid).toBe("bafyHelia");
    expect(r.pinnedRemotely).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(heliaLoader).toHaveBeenCalledTimes(1);
  });

  it("falls back to Helia when both remote providers fail", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "down" }, false, 500));
    const heliaLoader = vi.fn(async () => ({
      add: async () => ({ cid: "bafyHelia2" }),
    }));

    const pinner = new IpfsPinner({
      keys: { foureverland: { apiKey: "k1" }, pinata: { jwt: "j" } },
      fetchImpl: fetchMock as unknown as typeof fetch,
      heliaLoader,
    });

    const r = await pinner.pinBlob(new Uint8Array([1, 2, 3]), "x.bin");
    expect(r.provider).toBe("helia");
    expect(r.pinnedRemotely).toBe(false);
    // 4everland + Pinata each tried once
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws only when both remote providers fail AND Helia is unavailable", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "x" }, false, 500));
    const heliaLoader = vi.fn(async () => {
      throw new Error("no helia");
    });
    const pinner = new IpfsPinner({
      keys: { foureverland: { apiKey: "k" } },
      fetchImpl: fetchMock as unknown as typeof fetch,
      heliaLoader,
    });
    await expect(pinner.pinJson({})).rejects.toThrow(/All pinning providers failed/);
  });
});
