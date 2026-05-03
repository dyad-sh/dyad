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

### A. Subgraph + config

- [ ] Add DropERC1155 Goldsky endpoint to `src/config/joymarketplace.ts`
      (or wherever the existing subgraph URL lives). Keep it env-overridable.
- [ ] Document required Goldsky entities in this brief once confirmed:
      `claimConditions`, `tokens` (per-tokenId metadata), `claims`,
      `tokenOwners` / `transfers`.
- [ ] Add a tiny typed client (`src/lib/joymarketplace/drop_subgraph.ts`)
      with `listDrops`, `getDrop`, `listDropsByCreator`, `listClaimsByBuyer`,
      `getOwnership(tokenId, address)`. Pure functions, no React.

### B. Hooks (renderer read layer)

Repoint these hooks to the new client. Drop legacy listing types.

- [ ] `src/hooks/use_marketplace_browse.ts` → `listDrops` (paginated).
- [ ] `src/hooks/useThirdwebMarketplace.ts` → either remove or shrink to a thin
      wrapper around the drop client; do NOT keep MarketplaceV3 listing logic.
- [ ] `src/hooks/use_publish_agent.ts` / `use_publish_workflow.ts` —
      verify they only call the orchestrator (write side) and don't read
      MarketplaceV3 listings post-publish for confirmation.

### C. Pages

- [ ] `src/pages/joy/MarketplacePage.tsx` — browse grid sourced from `listDrops`.
- [ ] `src/pages/marketplace-explorer.tsx` — same.
- [ ] `src/pages/my-marketplace-assets.tsx` — `listDropsByCreator(currentWallet)`.
- [ ] `src/pages/nft-marketplace.tsx` — drop-detail view sourced from `getDrop`.
- [ ] `src/pages/creator-network/PublishTab.tsx` — published-list comes from
      `listDropsByCreator` (NOT from `agents.dry_run_at` / cloud listings).

### D. IPC / handlers

- [ ] `src/ipc/handlers/marketplace_browse_handlers.ts` — switch to drop client.
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
