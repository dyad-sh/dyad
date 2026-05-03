/**
 * Unit tests for the pure helpers exported from
 * `marketplace_browse_handlers.ts`. The actual ipcMain handlers touch
 * Electron + the network, so we limit assertions to the `__test__` bag:
 *   - ipfsToHttp() URI rewriting + gateway rotation
 *   - weiToDisplay() numeric conversion + null handling
 *   - toBrowseItem() and toAssetDetail() shape guarantees
 *
 * These helpers are the conversion edge between the on-chain DropERC1155
 * subgraph shape and the renderer's `MarketplaceBrowseItem` /
 * `MarketplaceAssetDetail` types, so getting them wrong silently corrupts
 * the marketplace UI.
 */

import { describe, it, expect } from "vitest";
import { __test__ } from "@/ipc/handlers/marketplace_browse_handlers";
import type { DropToken } from "@/lib/joymarketplace/drop_subgraph";

const { ipfsToHttp, weiToDisplay, toBrowseItem, toAssetDetail, isMyDrop } = __test__;

const baseToken: DropToken = {
  id: "11",
  tokenId: "11",
  baseURI: "ipfs://QmAbc",
  lazyMintedAt: "1700000000",
  lazyMintBlock: "1",
  lazyMintTxHash: "0xdead",
  pricePerToken: "1000000000000000000", // 1 MATIC in wei
  currency: "0x0",
  maxClaimableSupply: "100",
  supplyClaimed: "5",
  quantityLimitPerWallet: "1",
  conditionStartTimestamp: "1700000000",
  conditionUpdatedAt: "1700000100",
  totalPurchases: "5",
};

// ── ipfsToHttp ─────────────────────────────────────────────────────────────

describe("ipfsToHttp", () => {
  it("rewrites ipfs:// URIs through the default gateway", () => {
    expect(ipfsToHttp("ipfs://QmAbc")).toBe("https://ipfs.io/ipfs/QmAbc");
  });

  it("passes through https:// URIs untouched", () => {
    expect(ipfsToHttp("https://example.com/x.png")).toBe("https://example.com/x.png");
  });

  it("rotates through configured gateways by index", () => {
    const a = ipfsToHttp("ipfs://Qm1", 0);
    const b = ipfsToHttp("ipfs://Qm1", 1);
    const c = ipfsToHttp("ipfs://Qm1", 2);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toContain("ipfs.io");
    expect(b).toContain("pinata");
    expect(c).toContain("4everland");
  });

  it("handles ipfs://ipfs/ prefix", () => {
    expect(ipfsToHttp("ipfs://ipfs/QmAbc")).toBe("https://ipfs.io/ipfs/QmAbc");
  });

  it("returns empty string unchanged", () => {
    expect(ipfsToHttp("")).toBe("");
  });
});

// ── weiToDisplay ───────────────────────────────────────────────────────────

describe("weiToDisplay", () => {
  it("converts wei (18-decimal) to display units", () => {
    expect(weiToDisplay("1000000000000000000")).toBe(1);
    expect(weiToDisplay("500000000000000000")).toBe(0.5);
  });

  it("returns undefined for null / unparseable", () => {
    expect(weiToDisplay(null)).toBeUndefined();
    expect(weiToDisplay("not a number")).toBeUndefined();
  });

  it("handles 0 wei", () => {
    expect(weiToDisplay("0")).toBe(0);
  });
});

// ── toBrowseItem ───────────────────────────────────────────────────────────

describe("toBrowseItem", () => {
  it("falls back to defaults when metadata is null", () => {
    const item = toBrowseItem(baseToken, null);
    expect(item.id).toBe("11");
    expect(item.name).toBe("Drop #11");
    expect(item.assetType).toBe("model");
    expect(item.category).toBe("ai-workflow");
    expect(item.pricingModel).toBe("one-time");
    expect(item.price).toBe(1);
    expect(item.currency).toBe("MATIC");
    expect(item.downloads).toBe(5);
    expect(item.publisherName).toBe("Joy Creator");
    expect(item.publisherId).toBe("");
    expect(item.tags).toEqual([]);
  });

  it("derives free pricing when pricePerToken is null/0", () => {
    expect(toBrowseItem({ ...baseToken, pricePerToken: null }, null).pricingModel).toBe("free");
    expect(toBrowseItem({ ...baseToken, pricePerToken: "0" }, null).pricingModel).toBe("free");
  });

  it("uses metadata fields when present", () => {
    const item = toBrowseItem(baseToken, {
      name: "AwesomeAgent",
      description: "A really cool agent that does stuff",
      image: "ipfs://QmThumb",
      properties: {
        assetType: "agent",
        category: "automation",
        creatorWallet: "0xabc",
        creatorName: "Terry",
        tags: ["ai", "support"],
      },
    });
    expect(item.name).toBe("AwesomeAgent");
    expect(item.shortDescription).toBe("A really cool agent that does stuff");
    expect(item.assetType).toBe("agent");
    expect(item.category).toBe("automation");
    expect(item.thumbnailUrl).toBe("https://ipfs.io/ipfs/QmThumb");
    expect(item.publisherName).toBe("Terry");
    expect(item.publisherId).toBe("0xabc");
    expect(item.tags).toEqual(["ai", "support"]);
  });

  it("truncates very long descriptions to 200 chars", () => {
    const long = "x".repeat(5000);
    const item = toBrowseItem(baseToken, { description: long });
    expect(item.shortDescription).toHaveLength(200);
  });

  it("emits an ISO timestamp from lazyMintedAt", () => {
    const item = toBrowseItem(baseToken, null);
    expect(new Date(item.publishedAt).getTime()).toBe(1700000000 * 1000);
  });
});

// ── toAssetDetail ──────────────────────────────────────────────────────────

describe("toAssetDetail", () => {
  it("populates required fields from token + metadata", () => {
    const detail = toAssetDetail(baseToken, {
      name: "AwesomeAgent",
      description: "A really cool agent",
      image: "ipfs://QmThumb",
      properties: {
        assetType: "agent",
        category: "automation",
        license: "mit",
        creatorWallet: "0xabc",
        creatorName: "Terry",
        version: "2.1.0",
        tags: ["ai"],
        techStack: ["typescript", "ollama"],
        features: ["streaming", "rag"],
        screenshots: ["ipfs://QmShot1"],
        demoUrl: "https://demo.example",
        videoUrl: "https://video.example",
        requirements: "Node 20+",
        changelog: "Initial release",
      },
    });
    expect(detail.id).toBe("11");
    expect(detail.slug).toBe("drop-11");
    expect(detail.assetType).toBe("agent");
    expect(detail.category).toBe("automation");
    expect(detail.license).toBe("mit");
    expect(detail.publisherId).toBe("0xabc");
    expect(detail.publisherName).toBe("Terry");
    expect(detail.publisherVerified).toBe(true);
    expect(detail.version).toBe("2.1.0");
    expect(detail.techStack).toEqual(["typescript", "ollama"]);
    expect(detail.features).toEqual(["streaming", "rag"]);
    expect(detail.requirements).toBe("Node 20+");
    expect(detail.demoUrl).toBe("https://demo.example");
    expect(detail.changelog).toBe("Initial release");
    // screenshots must be rewritten through the IPFS gateway
    expect(detail.screenshotUrls[0]).toBe("https://ipfs.io/ipfs/QmShot1");
  });

  it("falls back to safe defaults when metadata is null", () => {
    const detail = toAssetDetail(baseToken, null);
    expect(detail.assetType).toBe("model");
    expect(detail.license).toBe("proprietary");
    expect(detail.version).toBe("1.0.0");
    expect(detail.publisherVerified).toBe(false);
    expect(detail.techStack).toEqual([]);
    expect(detail.features).toEqual([]);
    expect(detail.screenshotUrls).toEqual([]);
  });

  it("status is always `published` for on-chain drops", () => {
    expect(toAssetDetail(baseToken, null).status).toBe("published");
  });
});

// ── isMyDrop (creator-wallet predicate for marketplace:my-drops) ─────────────────────────────────────────────────────

describe("isMyDrop", () => {
  const wallet = "0xabcdef0000000000000000000000000000001234";

  it("returns false for null metadata", () => {
    expect(isMyDrop(null, wallet)).toBe(false);
  });

  it("returns false when creatorWallet is missing entirely", () => {
    expect(isMyDrop({ properties: {} }, wallet)).toBe(false);
    expect(isMyDrop({}, wallet)).toBe(false);
  });

  it("returns false when creatorWallet is non-string (defensive)", () => {
    expect(
      isMyDrop({ properties: { creatorWallet: 42 as unknown as string } }, wallet),
    ).toBe(false);
    expect(
      isMyDrop({ properties: { creatorWallet: "" } }, wallet),
    ).toBe(false);
  });

  it("returns true when creatorWallet matches the wallet (lower-case)", () => {
    expect(
      isMyDrop({ properties: { creatorWallet: wallet } }, wallet),
    ).toBe(true);
  });

  it("is case-insensitive on the metadata side", () => {
    const checksum = "0xABCDef0000000000000000000000000000001234";
    expect(isMyDrop({ properties: { creatorWallet: checksum } }, wallet)).toBe(true);
  });

  it("returns false on mismatch", () => {
    expect(
      isMyDrop(
        { properties: { creatorWallet: "0x000" } },
        wallet,
      ),
    ).toBe(false);
  });
});
