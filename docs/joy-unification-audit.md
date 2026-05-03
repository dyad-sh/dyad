# Joy Unification — End-to-End Audit (Phase B)

_Branch: `feat/joy-unification-A-B` · Auditor: LoveAssistant subagent · Date: 2026-05-02 EDT · Base commit: `bad37a84`_

This is the reality-check that has to land **before** the new code, because
prior sessions over-claimed completion (see `MEMORY.md` Apr 28 reality check).
Every claim below is grounded in a file path + line number from a fresh read
of the repo, not from memory.

---

## TL;DR — what actually exists vs. what doesn't

| Surface | Claimed in plan / memory | Reality |
|---|---|---|
| `marketplace-sync:sync-listing` reaches `joymarketplace.io` | Yes | **Partially true.** It hits a Supabase Edge Function (`/joycreate-sync-listing`) on `jgsbmnzhvuwiujqbaieo.supabase.co`, not literally `joymarketplace.io`. The plan's mental model of `joymarketplace.io/api/v1/*` REST does **not** exist. |
| `joymarketplace.io/api/v1/stores` / `…/assets` | Implied | **Does not exist.** Repo `joy-marketplace-80/api/` only has `ai/`, `indexer.ts`, `pin.ts`. No `v1/` tree. |
| `THIRDWEB_CONTRACTS.nftCollection` shared NFT | "Already wired" | **True** — `0xb099296fe65a2185731aC8B1411A56175e6Be47a` (JoyLicenseToken, ERC-1155) on **Polygon Amoy 80002** (testnet, NOT mainnet 137 as plan says). |
| Goldsky subgraphs (marketplace / stores / drop) | Wired in `src/config/thirdweb.ts` | **True** — three real Goldsky URLs at `goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-{marketplace,stores,drop}-amoy/…`. Untested by automation in the audit, but the URLs and `querySubgraph` helper are real code. |
| Six marketplace handler files all reach a real backend | Implied | **No** — see §2 below. Several are in-memory or talk to Supabase only. |
| Four marketplace pages mount and render | Implied | **Mostly true** — all four routes mount, but two import 60–128 KB monoliths with significant placeholder data. |

The honest summary: **there is real wiring** to a Supabase-Edge-Functions backend
and Goldsky subgraphs, but the unifying layer the plan describes does not yet
exist. There is no single typed client, no `joybridge:*` namespace, and the seven
overlapping marketplace handler files remain. This PR builds the unifying layer.

---

## 1. Marketplace handler file map

Files in `src/ipc/handlers/`:

| File | Size | Channel prefix | Status |
|---|---|---|---|
| `marketplace_handlers.ts` | 19 KB | `marketplace:*` (browse/install/featured/categories/get-url) | Real — backed by Supabase via `marketplaceListingService` (browse) and shell-out helpers. |
| `marketplace_browse_handlers.ts` | 4.9 KB | `marketplace:*` browse subset | Wraps Supabase queries to `joymarketplace.io` Supabase project. |
| `marketplace_sync_handlers.ts` | 14 KB | `marketplace-sync:*` (~24 channels) | **The real workhorse.** Calls Supabase Edge Functions (`/joycreate-sync-listing`, `/joy-create-verify`), Goldsky subgraphs via `querySubgraph()`, on-chain via `ethers` v6 against Polygon Amoy. |
| `marketplace_inbound_handlers.ts` | 6.3 KB | `marketplace-inbound:*` | Webhook dispatcher for incoming purchases — verified, but inert without server pushing to it. |
| `workflow_marketplace_handlers.ts` | 8.2 KB | `workflow-marketplace:*` | In-memory mocks for n8n workflow listings. Not wired to a real backend. |
| `agent_marketplace_handlers.ts` | 7.8 KB | `agent-marketplace:*` | In-memory mocks for agent listings. Not wired to a real backend. |
| `onchain_asset_bridge_handlers.ts` | 25 KB | `onchain-asset:*` | Bridges local IndexedDB → on-chain mints; real `ethers` calls. |
| `nft_handlers.ts` | 21 KB | `nft:*` | Real on-chain reads/writes via Thirdweb. |
| `subgraph_handlers.ts` | 3.7 KB | `subgraph:*` | Thin wrapper around `querySubgraph()` from `@/config/thirdweb`. |

**Conclusion:** Two of the six "marketplace-ish" namespaces (`workflow-marketplace`, `agent-marketplace`) are in-memory mocks. The actual wired path is `marketplace-sync:*` + `nft:*` + `subgraph:*` + `marketplace:browse`.

---

## 2. The `joymarketplace.io` claim — what it actually is

`src/config/joymarketplace.ts` line 138–161:

```ts
export const JOYMARKETPLACE_API = {
  baseUrl: process.env.JOYMARKETPLACE_API_URL
    || "https://jgsbmnzhvuwiujqbaieo.supabase.co/functions/v1",
  webUrl:  process.env.JOYMARKETPLACE_WEB_URL || "https://joymarketplace.io",
  // …
  endpoints: {
    verify:        "/joy-create-verify",
    syncListing:   "/joycreate-sync-listing",
    ingestReceipt: "/joycreate-receipt-ingest",
  },
};
```

So `JOYMARKETPLACE_API.baseUrl` is **the Supabase Edge Functions root**, not the
website. `marketplace-sync:sync-listing` does call it with a Bearer + apikey
header (`marketplace_sync_service.ts:243`), so the plumbing is real. But:

- There are **only three** edge functions wired today (`verify`, `syncListing`, `ingestReceipt`).
- The marketplace's Supabase project (`jgsbmnzhvuwiujqbaieo`) actually has **84 edge functions** (`gh api repos/DisciplesofLove/joy-marketplace-80/contents/supabase/functions` — May 2). Relevant ones not yet wired in JoyCreate:
  - `publish-asset` — full publish flow with deterministic tokenId (`keccak256(cid, tier)`).
  - `marketplace-listing`
  - `joycreate-publisher-verify`
  - `create-asset-full-flow`
  - `store-contract-factory`
  - `generate-store-bio`, `generate-store-image`, `generate-store-tagline`
- `joymarketplace.io/api/v1/stores` / `/api/v1/assets` as imagined in the plan **do not exist**. There is `joy-marketplace-80/api/pin.ts` (a Vercel-style serverless pin endpoint) and `joy-marketplace-80/api/indexer.ts`, both unrelated to a v1 tree.

**Decision for this PR (D-audit-1):** the new `joybridge_client.ts` will treat the Supabase Edge Functions tree as the canonical API. `baseUrl` defaults to `https://jgsbmnzhvuwiujqbaieo.supabase.co/functions/v1`, override-able via settings. The plan's `joymarketplace.io/api/v1/*` shape becomes a follow-up sprint that, if/when those routes get built on the marketplace Vercel app, the client switches by changing one config value.

---

## 3. Contract addresses — chain mismatch

Two sources of truth, **on different chains**:

| File | Chain | NFT address |
|---|---|---|
| `src/config/thirdweb.ts` | **Polygon Amoy 80002** (testnet) | `0xb099296fe65a2185731aC8B1411A56175e6Be47a` (JoyLicenseToken) |
| `src/config/joymarketplace.ts` `CONTRACT_ADDRESSES` | **Polygon Mainnet 137** (per `POLYGON_MAINNET`) | `0xA8566De9dA7bC1dD9D9595F56CFe34De7EaeF2CC` (JOY_ASSET_NFT) |

The Goldsky subgraphs are all `…-amoy` (testnet). The plan's D4 says "Polygon mainnet — already wired"; the active code path actually runs against **Amoy**. **TODO** before mainnet launch: pick one chain and reconcile both files. This PR does **not** change the chain — it surfaces the inconsistency in the audit and proceeds against Amoy (which is what the subgraph + Thirdweb deployment use).

---

## 4. The four current marketplace pages

| Route | File | Size | Mounts? |
|---|---|---|---|
| `/marketplace-explorer` | `src/pages/marketplace-explorer.tsx` | 13 KB | Yes — registered in `router.ts` line 67. |
| `/nft-marketplace` | `src/pages/nft-marketplace.tsx` | **128 KB** | Yes — line 18. Single-file monolith with most of the marketplace UI. |
| `/my-marketplace-assets` | `src/pages/my-marketplace-assets.tsx` | 39 KB | Yes — line 51. |
| `/creator-dashboard` | (separate concern; has store-management bits) | — | Yes — line 52. |
| `/plugin-marketplace` | `src/pages/PluginMarketplacePage.tsx` | 24 KB | Yes — line 41. **Different category, kept as-is.** |

The two big files (`nft-marketplace.tsx` 128 KB, `my-marketplace-assets.tsx` 39 KB) contain a mix of real subgraph reads and mock fixtures. Per **D9 (deprecate-don't-delete)**, this PR adds a deprecation banner pointing at `/joy/marketplace` etc., without removing the existing routes.

---

## 5. Preload exposure — confirmed bug pattern

`src/preload.ts` line 7 declares `validInvokeChannels` as an allow-list. Lines 634–658
list all 24 `marketplace-sync:*` channels. **Any new channel that isn't added here
silently fails at runtime** with no error in the renderer (it just rejects with
"channel not allowed"). This is exactly the bug from Collab Hub PR #16 (per
MEMORY.md). This PR adds all 11 new `joybridge:*` channels to `validInvokeChannels`
in the same edit.

---

## 6. Goldsky subgraphs — real

`src/config/thirdweb.ts` lines 41–55:

```ts
export const GOLDSKY_SUBGRAPHS = {
  marketplace: "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-marketplace-amoy/0.0.3/gn",
  stores:      "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-stores-amoy/0.0.2/gn",
  drop:        "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-drop-amoy/0.0.1/gn",
};
```

`querySubgraph(name, query, vars)` is a real GraphQL POST helper. Six handlers in
`marketplace_sync_handlers.ts` (lines 320–430) use it for active-listings,
store-by-owner, drops, plus three pass-through query channels. **No subgraph code
is changed in this PR**; `joybridge:goldsky-query` simply re-exposes the same
helper under the new namespace.

---

## 7. Five highlights for the PR review

1. **`joymarketplace.io/api/v1/*` doesn't exist.** Real backend = Supabase Edge Functions on `jgsbmnzhvuwiujqbaieo.supabase.co/functions/v1`. JoyBridge defaults to that, override-able.
2. **Chain mismatch unresolved.** `thirdweb.ts` runs on Amoy 80002; `joymarketplace.ts` references mainnet 137. This PR runs on Amoy (matches subgraphs + deployed contracts) and flags the reconciliation TODO.
3. **2 of 6 marketplace handler files are in-memory mocks** (`workflow-marketplace`, `agent-marketplace`). Not changed here; keep existing UX, deprecation banners point at `/joy/*`.
4. **24 `marketplace-sync:*` channels exist with full preload exposure**, so reusing them via shims is trivial — but D2 of this plan says the new code only goes through `joybridge:*`, so we add the new namespace and don't touch the old.
5. **Supabase publishable key is now provided** (Terry, 2026-05-02 18:19 EDT). Stored in workspace `.openclaw-secrets/joy-supabase.env`. The PR reads it from settings/env at runtime; nothing key-shaped is committed.
