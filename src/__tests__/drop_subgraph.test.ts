/**
 * Unit tests for the DropERC1155 + Stores subgraph client.
 *
 * Network is mocked at `globalThis.fetch`; assertions cover:
 *   - default endpoint resolution + env override
 *   - query body shape (operation name, variables) for each public function
 *   - HTTP / GraphQL error surfacing
 *   - pagination math + clamping
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  listDrops,
  getDrop,
  listDropsByCreator,
  listClaimsByBuyer,
  getOwnership,
  getStore,
  listStoresByOwner,
  summarizeDrop,
  getDropSubgraphUrl,
  getStoresSubgraphUrl,
  DEFAULT_DROP_SUBGRAPH_URL,
  DEFAULT_STORES_SUBGRAPH_URL,
  type DropToken,
} from "@/lib/joymarketplace/drop_subgraph";

// ── fetch mock ────────────────────────────────────────────────────────────

interface CapturedCall {
  url: string;
  body: { query: string; variables?: Record<string, unknown> };
}

let calls: CapturedCall[] = [];

function mockOnce(payload: unknown, status = 200) {
  (globalThis.fetch as unknown as vi.Mock).mockImplementationOnce(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  });
}

beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.JOYMARKETPLACE_DROP_SUBGRAPH_URL;
  delete process.env.JOYMARKETPLACE_STORES_SUBGRAPH_URL;
});

const sampleToken: DropToken = {
  id: "11",
  tokenId: "11",
  baseURI: "ipfs://QmFakeTokenMetadata",
  lazyMintedAt: "1777774000",
  lazyMintBlock: "37698800",
  lazyMintTxHash: "0xabcdef",
  pricePerToken: "1000000000000000000",
  currency: "0x0000000000000000000000000000000000000000",
  maxClaimableSupply: "100",
  supplyClaimed: "5",
  quantityLimitPerWallet: "1",
  conditionStartTimestamp: "1777770000",
  conditionUpdatedAt: "1777770000",
  totalPurchases: "5",
};

// ── endpoint resolution ───────────────────────────────────────────────────

describe("endpoint resolution", () => {
  it("returns the default Goldsky URLs when env is unset", () => {
    expect(getDropSubgraphUrl()).toBe(DEFAULT_DROP_SUBGRAPH_URL);
    expect(getStoresSubgraphUrl()).toBe(DEFAULT_STORES_SUBGRAPH_URL);
  });

  it("respects env overrides", () => {
    process.env.JOYMARKETPLACE_DROP_SUBGRAPH_URL = "https://example.com/drop";
    process.env.JOYMARKETPLACE_STORES_SUBGRAPH_URL = "https://example.com/stores";
    expect(getDropSubgraphUrl()).toBe("https://example.com/drop");
    expect(getStoresSubgraphUrl()).toBe("https://example.com/stores");
  });
});

// ── listDrops ─────────────────────────────────────────────────────────────

describe("listDrops", () => {
  it("paginates with sensible defaults and reports hasMore=false on a short page", async () => {
    mockOnce({ data: { tokens: [sampleToken] } });
    const result = await listDrops();
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(DEFAULT_DROP_SUBGRAPH_URL);
    expect(calls[0].body.query).toContain("tokens(");
    expect(calls[0].body.variables).toEqual({
      first: 20,
      skip: 0,
      orderBy: "lazyMintedAt",
      orderDirection: "desc",
    });
  });

  it("hasMore=true when items.length === pageSize", async () => {
    const tokens = Array.from({ length: 20 }, (_, i) => ({ ...sampleToken, id: String(i), tokenId: String(i) }));
    mockOnce({ data: { tokens } });
    const result = await listDrops({ pageSize: 20 });
    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(20);
  });

  it("clamps pageSize to [1, 100] and computes skip from page", async () => {
    mockOnce({ data: { tokens: [] } });
    await listDrops({ page: 3, pageSize: 5000 });
    expect(calls[0].body.variables).toMatchObject({ first: 100, skip: 200 });
  });

  it("clamps pageSize >= 1 (rejects 0/negative)", async () => {
    mockOnce({ data: { tokens: [] } });
    await listDrops({ page: 1, pageSize: 0 });
    expect(calls[0].body.variables).toMatchObject({ first: 1, skip: 0 });
  });

  it("respects sort overrides", async () => {
    mockOnce({ data: { tokens: [] } });
    await listDrops({ orderBy: "totalPurchases", orderDirection: "asc" });
    expect(calls[0].body.variables).toMatchObject({
      orderBy: "totalPurchases",
      orderDirection: "asc",
    });
  });
});

// ── getDrop ───────────────────────────────────────────────────────────────

describe("getDrop", () => {
  it("looks up by string tokenId and returns the token", async () => {
    mockOnce({ data: { token: sampleToken } });
    const t = await getDrop("11");
    expect(t).toEqual(sampleToken);
    expect(calls[0].body.variables).toEqual({ id: "11" });
  });

  it("accepts numeric and bigint tokenIds (stringifies them)", async () => {
    mockOnce({ data: { token: null } });
    await getDrop(42);
    expect(calls[0].body.variables).toEqual({ id: "42" });

    mockOnce({ data: { token: null } });
    await getDrop(99n);
    expect(calls[1].body.variables).toEqual({ id: "99" });
  });

  it("returns null for missing drops", async () => {
    mockOnce({ data: { token: null } });
    expect(await getDrop("999")).toBeNull();
  });
});

// ── listDropsByCreator ────────────────────────────────────────────────────

describe("listDropsByCreator", () => {
  it("requires a creator wallet", async () => {
    await expect(listDropsByCreator({ creator: "" })).rejects.toThrow(/creator wallet is required/i);
  });

  it("delegates to listDrops with same pagination semantics (subgraph lacks per-token creator)", async () => {
    mockOnce({ data: { tokens: [sampleToken] } });
    const result = await listDropsByCreator({ creator: "0xabc", page: 2, pageSize: 10 });
    expect(result.items).toHaveLength(1);
    expect(calls[0].body.variables).toMatchObject({ first: 10, skip: 10 });
  });
});

// ── listClaimsByBuyer ─────────────────────────────────────────────────────

describe("listClaimsByBuyer", () => {
  it("requires a buyer wallet", async () => {
    await expect(listClaimsByBuyer({ buyer: "" })).rejects.toThrow(/buyer wallet is required/i);
  });

  it("lower-cases the buyer address before querying", async () => {
    mockOnce({ data: { purchases: [] } });
    await listClaimsByBuyer({ buyer: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" });
    expect(calls[0].body.variables).toMatchObject({
      buyer: "0xabcdef1234567890abcdef1234567890abcdef12",
    });
  });

  it("paginates buyer claims", async () => {
    mockOnce({ data: { purchases: [{ id: "p1", tokenId: "1", claimer: "0x", receiver: "0x", quantity: "1", timestamp: "1", blockNumber: "1", txHash: "0x", claimConditionIndex: "0" }] } });
    const r = await listClaimsByBuyer({ buyer: "0xabc", page: 1, pageSize: 25 });
    expect(r).toHaveLength(1);
    expect(calls[0].body.variables).toMatchObject({ first: 25, skip: 0 });
  });
});

// ── getOwnership ──────────────────────────────────────────────────────────

describe("getOwnership", () => {
  it("requires a wallet address", async () => {
    await expect(getOwnership("1", "")).rejects.toThrow(/walletAddress is required/i);
  });

  it("issues a combined direct+where query and returns the direct hit when present", async () => {
    const balance = { id: "0xabc-1", user: "0xabc", tokenId: "1", totalClaimed: "2", lastClaimedAt: "100" };
    mockOnce({ data: { direct: balance, via_where: [] } });
    const result = await getOwnership("1", "0xABC");
    expect(result).toEqual(balance);
    expect(calls[0].body.variables).toMatchObject({ id: "0xabc-1", user: "0xabc", tokenId: "1" });
  });

  it("falls back to the where-filter result when direct is null", async () => {
    const balance = { id: "uniq", user: "0xabc", tokenId: "1", totalClaimed: "2", lastClaimedAt: "100" };
    mockOnce({ data: { direct: null, via_where: [balance] } });
    expect(await getOwnership("1", "0xabc")).toEqual(balance);
  });

  it("returns null when no balance is found", async () => {
    mockOnce({ data: { direct: null, via_where: [] } });
    expect(await getOwnership("1", "0xabc")).toBeNull();
  });
});

// ── stores subgraph ───────────────────────────────────────────────────────

describe("stores subgraph", () => {
  it("getStore hits the stores endpoint by id", async () => {
    mockOnce({ data: { store: { id: "love", owner: "0xabc", name: "Love", description: null, logo: null, website: null, tagline: null, isActive: true, createdAt: "1", updatedAt: "1" } } });
    const s = await getStore("love");
    expect(s?.id).toBe("love");
    expect(calls[0].url).toBe(DEFAULT_STORES_SUBGRAPH_URL);
    expect(calls[0].body.variables).toEqual({ id: "love" });
  });

  it("getStore requires an id", async () => {
    await expect(getStore("")).rejects.toThrow(/id is required/i);
  });

  it("listStoresByOwner lower-cases the owner and clamps `first`", async () => {
    mockOnce({ data: { stores: [] } });
    await listStoresByOwner("0xABC", 9999);
    expect(calls[0].body.variables).toMatchObject({ owner: "0xabc", first: 100 });
  });
});

// ── error surfacing ───────────────────────────────────────────────────────

describe("error surfacing", () => {
  it("throws on HTTP non-2xx", async () => {
    mockOnce({ error: "boom" }, 503);
    await expect(listDrops()).rejects.toThrow(/Subgraph HTTP 503/);
  });

  it("throws on GraphQL errors[]", async () => {
    mockOnce({ errors: [{ message: "bad query" }, { message: "really bad" }] });
    await expect(listDrops()).rejects.toThrow(/bad query.*really bad/);
  });

  it("throws when data is missing entirely", async () => {
    mockOnce({});
    await expect(listDrops()).rejects.toThrow(/empty data/);
  });
});

// ── summarizeDrop ─────────────────────────────────────────────────────────

describe("summarizeDrop", () => {
  it("formats a populated drop with baseURI + claim numbers", () => {
    const s = summarizeDrop(sampleToken);
    expect(s).toContain("Drop#11");
    expect(s).toContain("baseURI=ipfs://QmFakeTokenMetadata");
    expect(s).toContain("5/100");
  });

  it("handles a drop with no baseURI / no claim limit", () => {
    const t: DropToken = {
      ...sampleToken,
      baseURI: "",
      maxClaimableSupply: null,
      supplyClaimed: null,
    };
    const s = summarizeDrop(t);
    expect(s).toContain("no baseURI");
    expect(s).toContain("∞");
  });
});
