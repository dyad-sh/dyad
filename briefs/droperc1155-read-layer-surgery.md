# DropERC1155 Read-Layer Surgery

**Branch:** `feat/droperc1155-read-layer-surgery`
**Parent:** `main` (off `origin/main` @ `bad37a84`, independent of PR #20)
**Status:** Open / scoping
**Owner:** LoveAssistant + Terry
**Opened:** 2026-05-02 (follow-up to PR #20)

---

## Context

PR #20 (`feat/onchain-publish-orchestrator`) shipped the **write path** for the
locked-in marketplace architecture:

- ✅ DropERC1155 (`0x541DbAc...4402`) lazy-mint + claim conditions
- ✅ creatorGate (`0x3af616...3a40`) precheck
- ✅ IPFS pinning, dry-run + live `/publish_agent` for Telegram + Discord

What it intentionally **did not** touch is the **read path**. Browse, "my drops",
detail pages, and ownership checks still query the legacy marketplace stack:
MarketplaceV3 listings, the Supabase `joycreate-sync-listing` mirror, and the
old marketplace subgraph schema. After PR #20 merges, every newly published
agent will be on-chain via DropERC1155 but **invisible** to the UI because no
read query points there.

This branch closes that gap. It is the "surgery" half of the locked-in plan
(items 6 + tail of the hard→easy ladder in `MEMORY.md`).

---

## Goals

1. **All marketplace reads come from the DropERC1155 Goldsky subgraph.** No
   queries against MarketplaceV3 listings or the Supabase listing mirror.
2. **Dead paths are removed, not commented out.** MarketplaceV3 helpers,
   `marketplace_sync_service.ts`'s cloud-listing calls, and any
   `/joycreate-sync-listing` Supabase function clients get deleted.
3. **One way to publish, one way to read.** A future contributor reading the
   code cannot accidentally rebuild against the wrong contract.

## Non-goals

- Buyer-side `claim()` flow (item 7 in the ladder — separate branch).
- WalletProvider/signer UI rework (item 1 — already shipped in PR #20 scope).
- UI polish / redesign of marketplace pages.

---

## Surgery Checklist

### A. Subgraph + config — DONE 2026-05-02

- [x] Confirmed live Goldsky endpoints via `_meta` + introspection. Both
      indexed to block 37,698,890+, no indexing errors.
      - Drop: `joy-drop-amoy/0.0.1` (entities: `Token`, `Purchase`,
        `UserBalance`, `DropStats`).
      - Stores: `joy-stores-amoy/0.0.3` (entities: `Store`,
        `StoreTextRecord`, `DomainRegistration`, `DomainTextRecord`,
        `StoreStats`).
- [x] Bumped stores subgraph URL `0.0.2` → `0.0.3` in
      `src/lib/subgraph_client.ts` and `src/config/thirdweb.ts`. Removed
      the now-retired `joy-marketplace-amoy` URL from `GOLDSKY_SUBGRAPHS`
      in `thirdweb.ts` and added a deprecation note where it still lives
      in `subgraph_client.ts` (kept only so legacy callers compile while
      we work through B/C/D).
- [x] New typed client at `src/lib/joymarketplace/drop_subgraph.ts` with
      `listDrops`, `getDrop`, `listDropsByCreator`, `listClaimsByBuyer`,
      `getOwnership`, `getStore`, `listStoresByOwner`, `summarizeDrop`.
      Endpoints are env-overridable via
      `JOYMARKETPLACE_DROP_SUBGRAPH_URL` /
      `JOYMARKETPLACE_STORES_SUBGRAPH_URL`.
- [x] Live smoke at `scripts/smoke-test-drop-subgraph.mjs` confirmed
      against Polygon Amoy: 12 lazy-minted tokens already indexed, the
      `love` store reads as `isActive: true`.

### A.1. Browse handler rewrite — DONE 2026-05-02

- [x] `src/ipc/handlers/marketplace_browse_handlers.ts` now uses the new
      drop client only. Browse / detail / featured / categories all flow
      through `listDrops` + `getDrop`.
- [x] Returns the proper `MarketplaceBrowseResult` shape (the previous
      handler returned `{assets, listings, total}` which never matched
      `IpcClient.marketplaceBrowse`'s return type — the renderer was
      effectively broken).
- [x] Resolves `baseURI` metadata via a 3-gateway IPFS fallback
      (`ipfs.io` → `pinata` → `4everland`) with a 5-minute in-process
      cache. Filters by category / assetType / pricingModel / free-text
      `query` against the resolved metadata.
- [x] `marketplace:asset-detail` returns a fully populated
      `MarketplaceAssetDetail` with `screenshotUrls` rewritten through
      the IPFS gateway, `publisherVerified` derived from the presence of
      a `creatorWallet` in metadata, and `status` always `"published"`
      (on-chain drops are by definition published).
- [x] `marketplace:install-asset` looks up the drop on-chain first and
      writes a manifest containing the resolved `baseURI` so the renderer
      can fetch from IPFS without another round trip.

### A.2. Tests — DONE 2026-05-02

- [x] 27 unit tests for `drop_subgraph.ts` (mocked GraphQL transport)
      covering pagination clamping, env override, error surfacing,
      address lower-casing, ownership fall-through.
- [x] 16 unit tests for `marketplace_browse_handlers.ts` helpers
      (`ipfsToHttp`, `weiToDisplay`, `toBrowseItem`, `toAssetDetail`)
      covering metadata fallbacks, gateway rotation, free / paid pricing
      derivation, description truncation.
- [x] `tsc --noEmit` clean. `oxlint` clean.

**Note for follow-up:** the live `love` store's `owner` field on the
subgraph reads as `0x40cc...ac7a` (the JoyRegistrarController), not the
.joy domain owner. That means `listStoresByOwner(walletAddress)` won't
surface stores by their human owner today — the join needs to go through
`DomainRegistration.owner` rather than `Store.owner`. Out of scope for
section A; will fix in section B (creator dashboard hook).

### B. Hooks (renderer read layer) — DONE 2026-05-02

- [x] `src/hooks/use_marketplace_browse.ts` — already routes through the
      browse-handler IPC surface (rewritten in A.1) so `useMarketplaceBrowse`
      / `useMarketplaceAssetDetail` / `useMarketplaceFeatured` /
      `useMarketplaceCategories` / `useInstallAsset` are correct as-is.
      EXTENDED with four new wallet-scoped read hooks: `useMyDrops`,
      `useMyClaims`, `useOwnership`, `useMyStores`. They are no-op
      (`enabled: false`) when no wallet is connected.
- [x] `src/hooks/useThirdwebMarketplace.ts` — SHRUNK to a deprecation stub.
      The old hook called `marketplace-sync:sync-listing` (Supabase mirror
      of MarketplaceV3 listings). The replacement keeps the same call
      signature so the legacy `CreateAssetWizard.tsx` continues to compile,
      but `createDirectListing` now `console.warn`s and returns
      `{ success: false, error: "… disabled…" }`. The wizard itself goes
      away in section E.
- [x] `src/hooks/use_publish_agent.ts` / `use_publish_workflow.ts` —
      verified write-side only. They invoke `agentPublishToMarketplace` /
      `workflowPublishToMarketplace` (DropERC1155 orchestrator) and on
      success only invalidate the `agents` / `workflows` / `creator`
      caches. NO post-publish MarketplaceV3 read, NO `marketplace-sync:*`
      call, NO Supabase listing-mirror confirmation. Verification recorded
      in JSDoc on each hook.

#### B supporting changes

- [x] New `listStoresByDomainOwner(wallet)` in
      `src/lib/joymarketplace/drop_subgraph.ts` — the join the section A
      note flagged. Walks `DomainRegistration.owner == wallet` →
      `Store.id == label`, because the live `Store.owner` field resolves
      to the JoyRegistrarController contract, not the human wallet.
- [x] Four new IPC handlers in `marketplace_browse_handlers.ts`:
      `marketplace:my-drops` (browse-shaped, filtered by metadata
      `creatorWallet`), `marketplace:my-claims` (raw `DropPurchase[]`),
      `marketplace:ownership` (`DropUserBalance | null`),
      `marketplace:my-stores` (`JoyStore[]` via the domain-owner join).
- [x] All four channels added to `validInvokeChannels` in `src/preload.ts`
      and exposed on `IpcClient` as `marketplaceMyDrops` / `marketplaceMyClaims`
      / `marketplaceOwnership` / `marketplaceMyStores`.
- [x] Renderer-safe types added to `src/types/publish_types.ts`
      (`DropPurchaseRecord`, `DropOwnershipRecord`, `JoyStoreRecord`,
      `MyDropsParams`, `MyClaimsParams`, `OwnershipParams`) so the
      renderer can hold them without pulling in `electron-log`.
- [x] New pure helper `isMyDrop(meta, walletLower)` in
      `marketplace_browse_handlers.ts` — used by `marketplace:my-drops`
      and unit-tested via the `__test__` bag.
- [x] **Tests:** 5 new tests for `listStoresByDomainOwner` in
      `drop_subgraph.test.ts` (now 32 total) and 6 new tests for `isMyDrop`
      in `marketplace_browse_handlers.test.ts` (now 22 total). All 54 pass.
      `tsc --noEmit` clean. `oxlint` clean on every file touched.

### C. Pages

- [ ] `src/pages/joy/MarketplacePage.tsx` — browse grid sourced from `listDrops`.
- [ ] `src/pages/marketplace-explorer.tsx` — same.
- [ ] `src/pages/my-marketplace-assets.tsx` — `listDropsByCreator(currentWallet)`.
- [ ] `src/pages/nft-marketplace.tsx` — drop-detail view sourced from `getDrop`.
- [ ] `src/pages/creator-network/PublishTab.tsx` — published-list comes from
      `listDropsByCreator` (NOT from `agents.dry_run_at` / cloud listings).

### D. IPC / handlers

- [x] `src/ipc/handlers/marketplace_browse_handlers.ts` — switched to drop client (see A.1).
- [ ] `src/ipc/handlers/marketplace_handlers.ts` — audit; remove
      MarketplaceV3-shaped responses.
- [ ] `src/ipc/handlers/marketplace_sync_handlers.ts` — likely DELETE the
      Supabase listing-mirror handlers entirely. Confirm no caller depends on
      them after the hook migration.
- [ ] `src/ipc/marketplace_sync_client.ts` — DELETE if handlers gone.

### E. Dead code removal (final pass, only after A–D green)

- [ ] `src/lib/marketplace_sync_service.ts` — delete the `joycreate-sync-listing`
      Supabase function calls. If the file ends up empty, delete the file.
- [ ] Search the repo for `createListing`, `buyFromListing`, `MarketplaceV3`,
      `auction`, `directListing` — every match should be in tests, deleted code,
      or a clearly-marked legacy migration. Production code paths must be zero.
- [ ] Remove unused contract addresses / ABIs from
      `src/config/joymarketplace.ts`.

### F. Tests

- [ ] Unit tests for `drop_subgraph.ts` client (mocked GraphQL transport).
- [ ] Update any test that asserts on MarketplaceV3 listing shapes —
      either repoint or delete.
- [ ] `tsc --noEmit` clean, `oxlint` clean, vitest green.

### G. Docs

- [ ] Update `docs/JOYMARKETPLACE_INTEGRATION.md`: read-layer section now
      describes Goldsky DropERC1155 subgraph queries, not MarketplaceV3 REST.
- [ ] Update this brief's status as items land.

---

## Acceptance criteria

1. Publishing an agent via `/publish_agent` (or the in-app publish wizard) makes
   it appear on the browse page and the creator's "my drops" page **without**
   touching any Supabase listing table.
2. `git grep -i 'createListing\|MarketplaceV3\|joycreate-sync-listing'`
   returns only references in this brief, deleted-code commit messages, or
   migration files. Zero hits in `src/`.
3. `tsc --noEmit`, lint, and vitest all pass.
4. Manual smoke (with seeded subgraph fixture or live Amoy data) shows browse +
   detail + creator pages rendering DropERC1155 data end-to-end.

---

## Out-of-scope follow-ups (separate branches)

- Buyer `claim()` UX + IPC.
- Subgraph health monitoring / fallback when Goldsky lags.
- Pricing / claim-condition editor UI.
