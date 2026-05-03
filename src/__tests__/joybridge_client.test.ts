/**
 * Tests for JoyBridgeClient — exercises every method against a mocked fetch,
 * including success, server-error, and network-error paths.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  JoyBridgeClient,
  resetJoyBridgeClientForTests,
  getJoyBridgeClient,
} from "@/lib/joybridge_client";

function mockFetch(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return responder(url, init);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("JoyBridgeClient — config", () => {
  beforeEach(() => resetJoyBridgeClientForTests());

  it("defaults apiBase to the Supabase Edge Functions root", () => {
    const c = new JoyBridgeClient();
    expect(c.getConfig().apiBase).toContain("supabase.co/functions/v1");
    expect(c.getConfig().connected).toBe(false);
    expect(c.getConfig().supabaseConfigured).toBe(false);
  });

  it("respects apiBase override", () => {
    const c = new JoyBridgeClient({
      apiBase: "https://example.test/api/v1",
    });
    expect(c.getConfig().apiBase).toBe("https://example.test/api/v1");
  });

  it("setCredentials updates connected/supabaseConfigured flags", () => {
    const c = new JoyBridgeClient();
    c.setCredentials({
      apiKey: "joy_test_key",
      supabaseUrl: "https://x.supabase.co",
      supabasePublishableKey: "sb_publishable_x",
    });
    expect(c.getConfig().connected).toBe(true);
    expect(c.getConfig().supabaseConfigured).toBe(true);
  });

  it("getJoyBridgeClient returns a singleton", () => {
    expect(getJoyBridgeClient()).toBe(getJoyBridgeClient());
  });
});

describe("JoyBridgeClient — auth headers", () => {
  it("sends Bearer + x-joy-api-key + apikey when configured", async () => {
    let captured: { url: string; headers?: Record<string, string> } | undefined;
    const fetchImpl = mockFetch(async (url, init) => {
      captured = {
        url,
        headers: init?.headers as Record<string, string> | undefined,
      };
      return jsonResponse({ id: "s1", slug: "test", name: "Test" });
    });

    const c = new JoyBridgeClient({
      apiKey: "joy_secret",
      supabasePublishableKey: "sb_publishable_pub",
      fetchImpl,
    });
    await c.getStore("test");

    expect(captured?.url).toContain("joybridge-get-store");
    expect(captured?.url).toContain("slug=test");
    const h = captured?.headers ?? {};
    expect(h["Authorization"]).toBe("Bearer joy_secret");
    expect(h["x-joy-api-key"]).toBe("joy_secret");
    expect(h["apikey"]).toBe("sb_publishable_pub");
  });

  it("omits auth headers when no apiKey", async () => {
    let h: Record<string, string> | undefined;
    const fetchImpl = mockFetch(async (_u, init) => {
      h = init?.headers as Record<string, string>;
      return jsonResponse({ items: [] });
    });
    const c = new JoyBridgeClient({ fetchImpl });
    await c.browseMarketplace();
    expect(h?.Authorization).toBeUndefined();
    expect(h?.["x-joy-api-key"]).toBeUndefined();
  });
});

describe("JoyBridgeClient — happy paths", () => {
  it("createStore POSTs JSON and returns Result<Store>", async () => {
    const fetchImpl = mockFetch(async (_u, init) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.slug).toBe("my-shop");
      return jsonResponse({
        id: "store_1",
        slug: "my-shop",
        name: "My Shop",
        status: "active",
      });
    });
    const c = new JoyBridgeClient({ apiKey: "k", fetchImpl });
    const res = await c.createStore({ slug: "my-shop", name: "My Shop" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.slug).toBe("my-shop");
  });

  it("publishAsset hits the publish-asset edge function", async () => {
    const fetchImpl = mockFetch(async (url, init) => {
      expect(url).toContain("publish-asset");
      expect(init?.method).toBe("POST");
      return jsonResponse({
        id: "a1",
        storeId: "store_1",
        assetType: "image",
        name: "Cat.png",
      });
    });
    const c = new JoyBridgeClient({ apiKey: "k", fetchImpl });
    const res = await c.publishAsset({
      storeId: "store_1",
      assetType: "image",
      name: "Cat.png",
      contentCid: "bafy...",
    });
    expect(res.ok).toBe(true);
  });

  it("listMyStores / listMyAssets / browseMarketplace all return arrays/objects", async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.includes("list-my-stores")) return jsonResponse([{ id: "s1", slug: "a", name: "A" }]);
      if (url.includes("list-my-assets")) return jsonResponse([{ id: "a1", storeId: "s1", assetType: "image", name: "x" }]);
      if (url.includes("marketplace-listing")) return jsonResponse({ items: [], nextCursor: undefined });
      return jsonResponse({});
    });
    const c = new JoyBridgeClient({ apiKey: "k", fetchImpl });

    const stores = await c.listMyStores();
    expect(stores.ok && stores.data.length).toBe(1);

    const assets = await c.listMyAssets();
    expect(assets.ok && assets.data.length).toBe(1);

    const browse = await c.browseMarketplace({ assetType: "image", limit: 12 });
    expect(browse.ok).toBe(true);
  });

  it("browseMarketplace serialises query params correctly", async () => {
    let capturedUrl = "";
    const fetchImpl = mockFetch(async (url) => {
      capturedUrl = url;
      return jsonResponse({ items: [] });
    });
    const c = new JoyBridgeClient({ fetchImpl });
    await c.browseMarketplace({
      assetType: "video",
      storeSlug: "shop",
      search: "cat dog",
      cursor: "abc",
      limit: 5,
    });
    expect(capturedUrl).toContain("assetType=video");
    expect(capturedUrl).toContain("storeSlug=shop");
    expect(capturedUrl).toContain("search=cat+dog");
    expect(capturedUrl).toContain("cursor=abc");
    expect(capturedUrl).toContain("limit=5");
  });

  it("goldskyQuery posts to a custom endpoint and unwraps data", async () => {
    const fetchImpl = mockFetch(async (url, init) => {
      expect(url).toBe("https://goldsky.test/sub");
      expect(init?.method).toBe("POST");
      return jsonResponse({ data: { stores: [{ id: "1" }] } });
    });
    const c = new JoyBridgeClient({ fetchImpl });
    const res = await c.goldskyQuery<{ stores: Array<{ id: string }> }>(
      "https://goldsky.test/sub",
      "{ stores { id } }",
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.stores[0].id).toBe("1");
  });
});

describe("JoyBridgeClient — error paths", () => {
  it("returns Result.ok=false with status on non-2xx", async () => {
    const fetchImpl = mockFetch(async () => new Response("nope", { status: 500 }));
    const c = new JoyBridgeClient({ fetchImpl });
    const res = await c.listMyStores();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(500);
      expect(res.error).toContain("nope");
    }
  });

  it("returns Result.ok=false on network error (does not throw)", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const c = new JoyBridgeClient({ fetchImpl });
    const res = await c.listMyAssets();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("ECONNREFUSED");
  });

  it("goldskyQuery surfaces GraphQL errors", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse({ errors: [{ message: "field not found" }] }),
    );
    const c = new JoyBridgeClient({ fetchImpl });
    const res = await c.goldskyQuery("https://x", "{ broken }");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("field not found");
  });

  it("pinToIpfs handles fetch failure gracefully", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new TypeError("network down");
    });
    const c = new JoyBridgeClient({ fetchImpl });
    const res = await c.pinToIpfs({
      data: new Uint8Array([1, 2, 3]).buffer,
      filename: "x.bin",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("network down");
  });

  it("pinToIpfs returns CID on success", async () => {
    const fetchImpl = mockFetch(async (url) => {
      expect(url).toContain("/pin");
      return jsonResponse({ cid: "bafy123", size: 3 });
    });
    const c = new JoyBridgeClient({ apiKey: "k", fetchImpl });
    const res = await c.pinToIpfs({
      data: new Uint8Array([1, 2, 3]).buffer,
      filename: "x.bin",
      contentType: "application/octet-stream",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.cid).toBe("bafy123");
  });
});

describe("JoyBridgeClient — edge cases", () => {
  it("tolerates empty 200 responses", async () => {
    const fetchImpl = mockFetch(async () => new Response("", { status: 200 }));
    const c = new JoyBridgeClient({ fetchImpl });
    const res = await c.getStore("anything");
    expect(res.ok).toBe(true);
  });

  it("falls back to text body when response isn't JSON", async () => {
    const fetchImpl = mockFetch(
      async () => new Response("plain text", { status: 200 }),
    );
    const c = new JoyBridgeClient({ fetchImpl });
    const res = await c.getStore("foo");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data as unknown).toBe("plain text");
  });
});
