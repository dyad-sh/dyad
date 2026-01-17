/**
 * Decentralized Deployment Hooks
 * React hooks for deploying apps to Web3 platforms
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { showError, showSuccess } from "@/lib/toast";

// Query keys
export const decentralizedKeys = {
  all: ["decentralized"] as const,
  platforms: () => [...decentralizedKeys.all, "platforms"] as const,
  credentials: (platform: string) =>
    [...decentralizedKeys.all, "credentials", platform] as const,
  deployments: (appId?: number) =>
    [...decentralizedKeys.all, "deployments", appId] as const,
  deployment: (id: string) =>
    [...decentralizedKeys.all, "deployment", id] as const,
};

// Types - matches PlatformConfig from src/types/decentralized_deploy.ts
export interface DecentralizedPlatformConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  website: string;
  features: string[];
  pricing: "free" | "freemium" | "paid";
  permanence: "permanent" | "pinned" | "temporary";
  supportsCustomDomains: boolean;
  supportsENS: boolean;
  supportsIPNS: boolean;
  requiresApiKey: boolean;
  chainSupport?: string[];
}

export interface DecentralizedCredentials {
  platform: string;
  apiKey?: string;
  accessToken?: string;
  projectId?: string;
  bucketName?: string;
  walletKey?: string;
}

export interface DecentralizedDeployRequest {
  appId: number;
  platform: string;
  buildCommand?: string;
  outputDir?: string;
  envVars?: Record<string, string>;
  ensName?: string;
  customDomain?: string;
  metadata?: Record<string, unknown>;
}

export interface DecentralizedDeployment {
  id: string;
  appId: number;
  platform: string;
  status: string;
  cid?: string;
  txId?: string;
  url: string;
  gatewayUrls: string[];
  ensName?: string;
  customDomain?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Hook to get all supported decentralized platforms
 */
export function useDecentralizedPlatforms() {
  return useQuery({
    queryKey: decentralizedKeys.platforms(),
    queryFn: async () => {
      const client = IpcClient.getInstance();
      return client.getDecentralizedPlatforms();
    },
  });
}

/**
 * Hook to get credentials for a specific platform
 */
export function useDecentralizedCredentials(platform: string) {
  return useQuery({
    queryKey: decentralizedKeys.credentials(platform),
    queryFn: async () => {
      const client = IpcClient.getInstance();
      return client.getDecentralizedCredentials(platform);
    },
    enabled: !!platform,
  });
}

/**
 * Hook to save platform credentials
 */
export function useSaveDecentralizedCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      platform,
      credentials,
    }: {
      platform: string;
      credentials: DecentralizedCredentials;
    }) => {
      const client = IpcClient.getInstance();
      return client.saveDecentralizedCredentials(platform, credentials);
    },
    onSuccess: (_, { platform }) => {
      queryClient.invalidateQueries({
        queryKey: decentralizedKeys.credentials(platform),
      });
      showSuccess(`${platform} credentials saved`);
    },
    onError: (error) => {
      showError(error);
    },
  });
}

/**
 * Hook to remove platform credentials
 */
export function useRemoveDecentralizedCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (platform: string) => {
      const client = IpcClient.getInstance();
      return client.removeDecentralizedCredentials(platform);
    },
    onSuccess: (_, platform) => {
      queryClient.invalidateQueries({
        queryKey: decentralizedKeys.credentials(platform),
      });
      showSuccess(`${platform} credentials removed`);
    },
    onError: (error) => {
      showError(error);
    },
  });
}

/**
 * Hook to deploy to a decentralized platform
 */
export function useDecentralizedDeploy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: DecentralizedDeployRequest) => {
      const client = IpcClient.getInstance();
      return client.deployToDecentralized(request);
    },
    onSuccess: (result, request) => {
      if (result.success) {
        queryClient.invalidateQueries({
          queryKey: decentralizedKeys.deployments(request.appId),
        });
        showSuccess(`Deployed to ${request.platform}!`);
      } else {
        showError(new Error(result.error || "Deployment failed"));
      }
    },
    onError: (error) => {
      showError(error);
    },
  });
}

/**
 * Hook to get deployments for an app
 */
export function useDecentralizedDeployments(appId?: number) {
  return useQuery({
    queryKey: decentralizedKeys.deployments(appId),
    queryFn: async () => {
      const client = IpcClient.getInstance();
      return client.getDecentralizedDeployments(appId);
    },
  });
}

/**
 * Hook to get a single deployment
 */
export function useDecentralizedDeployment(deploymentId: string) {
  return useQuery({
    queryKey: decentralizedKeys.deployment(deploymentId),
    queryFn: async () => {
      const client = IpcClient.getInstance();
      return client.getDecentralizedDeployment(deploymentId);
    },
    enabled: !!deploymentId,
  });
}

/**
 * Hook to check IPFS pin status
 */
export function useCheckPinStatus() {
  return useMutation({
    mutationFn: async ({ cid, platform }: { cid: string; platform: string }) => {
      const client = IpcClient.getInstance();
      return client.checkDecentralizedPinStatus(cid, platform);
    },
  });
}
