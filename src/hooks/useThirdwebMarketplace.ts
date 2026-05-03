/**
 * useThirdwebMarketplace — DEPRECATED (kept as a deprecation stub).
 *
 * Status (2026-05-02 architecture pivot):
 *   This hook used to call `marketplace-sync:sync-listing`, which mirrored a
 *   MarketplaceV3 direct listing into the Supabase `joycreate-sync-listing`
 *   function. Both of those paths are dead under the locked-in DropERC1155
 *   architecture (see briefs/droperc1155-read-layer-surgery.md, MEMORY.md
 *   "🚨 Joy Marketplace Architecture (LOCKED IN)").
 *
 * Why it still exists:
 *   The legacy `CreateAssetWizard.tsx` (and any other surface that imports
 *   `createDirectListing`) is scheduled for deletion in Section E of the
 *   read-layer surgery (final dead-code sweep). Keeping a stub with a
 *   stable call signature lets us land Section B without touching the
 *   ~3300-line wizard, while making sure any actual *call* fails loudly
 *   instead of silently writing to a retired Supabase function.
 *
 * Replacement:
 *   To publish, use the on-chain orchestrator wired through
 *   `agent:publish-to-marketplace` / `workflow:publish-to-marketplace`
 *   (see `usePublishAgent` / `usePublishWorkflow`). Those mint via
 *   DropERC1155 + creatorGate, with no MarketplaceV3 listing.
 */

import { useCallback } from "react";

/**
 * Loosely-typed params kept for backward compatibility with the existing
 * `CreateAssetWizard` call site. We intentionally do NOT validate the shape
 * — the only thing this hook does now is throw.
 */
export interface DeprecatedDirectListingParams {
  [key: string]: unknown;
}

export interface DeprecatedDirectListingResult {
  success: boolean;
  error: string;
  transactionHash?: undefined;
}

/**
 * @deprecated MarketplaceV3 listings are no longer supported. Use
 *   `usePublishAgent` / `usePublishWorkflow` (DropERC1155 lazy-mint) instead.
 *   This hook is retained only so the legacy `CreateAssetWizard` continues
 *   to compile until Section E rips it out.
 */
export function useThirdwebMarketplace() {
  const createDirectListing = useCallback(
    async (
      _params: DeprecatedDirectListingParams,
    ): Promise<DeprecatedDirectListingResult> => {
      const message =
        "MarketplaceV3 direct listings are disabled. Publish via " +
        "DropERC1155 (use the on-chain publish orchestrator).";
      // Surface in the dev console so a stray click during development is
      // obvious; production code paths shouldn't reach here at all.
      // eslint-disable-next-line no-console
      console.warn("[useThirdwebMarketplace.createDirectListing]", message);
      return { success: false, error: message };
    },
    [],
  );

  return { createDirectListing, isLoading: false as const };
}
