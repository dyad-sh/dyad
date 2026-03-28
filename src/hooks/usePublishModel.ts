/**
 * Marketplace Model Publishing Hook
 * TanStack Query mutation for publishing trained models to JoyMarketplace
 */

import { useMutation } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { PublishModelRequest } from "@/types/marketplace_types";
import { showError, showSuccess } from "@/lib/toast";

const ipc = IpcClient.getInstance();

export function usePublishModel() {
  return useMutation({
    mutationFn: (request: PublishModelRequest) => ipc.publishModel(request),
    onSuccess: (response) => {
      if (response.success) {
        showSuccess(`Model published! ${response.assetUrl || ""}`);
      } else {
        showError(`Publish failed: ${response.message}`);
      }
    },
    onError: (error: Error) => {
      showError(`Publish failed: ${error.message}`);
    },
  });
}
