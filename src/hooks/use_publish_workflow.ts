/**
 * Workflow Publish Hook — TanStack Query mutation for publishing workflows
 * to JoyMarketplace (DropERC1155 lazy-mint via the on-chain publish
 * orchestrator).
 *
 * Section B verification (briefs/droperc1155-read-layer-surgery.md):
 *   This hook is write-side only. It calls `workflowPublishToMarketplace`
 *   (which routes through `workflow:publish-to-marketplace` → the on-chain
 *   orchestrator) and on success invalidates the `workflows` and `creator`
 *   query caches. There is NO post-publish read against MarketplaceV3
 *   listings, NO call to `marketplace-sync:*`, and NO Supabase
 *   listing-mirror confirmation. Correct under the DropERC1155 locked-in
 *   architecture.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "../ipc/ipc_client";
import type { UnifiedPublishPayload, PublishResult } from "@/types/publish_types";
import { showError } from "@/lib/toast";
import { creatorKeys } from "./use_creator_dashboard";

const client = IpcClient.getInstance();

export function usePublishWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UnifiedPublishPayload): Promise<PublishResult> =>
      client.workflowPublishToMarketplace(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: creatorKeys.all });
    },
    onError: (error) => {
      showError(error instanceof Error ? error : new Error(String(error)));
    },
  });
}

export function useUnpublishWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string): Promise<void> =>
      client.workflowUnpublish(workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: creatorKeys.all });
    },
    onError: (error) => {
      showError(error instanceof Error ? error : new Error(String(error)));
    },
  });
}
