// =============================================================================
// Local Vault React Hooks — TanStack Query wrappers for all vault IPC calls
// =============================================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LocalVaultClient } from "../ipc/clients/local_vault_client";
import type {
  VaultConfig,
  ConnectorType,
  TransformStageConfig,
} from "../types/local_vault";

const client = LocalVaultClient.getInstance();

// ---- Query Keys ----

export const vaultKeys = {
  all: ["local-vault"] as const,
  status: () => [...vaultKeys.all, "status"] as const,
  config: () => [...vaultKeys.all, "config"] as const,
  connectors: () => [...vaultKeys.all, "connectors"] as const,
  connector: (id: string) => [...vaultKeys.all, "connector", id] as const,
  assets: (filters?: Record<string, unknown>) =>
    [...vaultKeys.all, "assets", filters ?? {}] as const,
  asset: (id: string) => [...vaultKeys.all, "asset", id] as const,
  assetContent: (id: string) => [...vaultKeys.all, "asset-content", id] as const,
  transforms: () => [...vaultKeys.all, "transforms"] as const,
  transform: (id: string) => [...vaultKeys.all, "transform", id] as const,
  packages: () => [...vaultKeys.all, "packages"] as const,
  package: (id: string) => [...vaultKeys.all, "package", id] as const,
  policies: () => [...vaultKeys.all, "policies"] as const,
  policy: (id: string) => [...vaultKeys.all, "policy", id] as const,
  bundles: () => [...vaultKeys.all, "bundles"] as const,
  bundle: (id: string) => [...vaultKeys.all, "bundle", id] as const,
  audit: () => [...vaultKeys.all, "audit"] as const,
};

// ---- Vault Core ----

export function useVaultStatus() {
  return useQuery({
    queryKey: vaultKeys.status(),
    queryFn: () => client.getVaultStatus(),
    refetchInterval: 30_000,
  });
}

export function useVaultConfig() {
  return useQuery({
    queryKey: vaultKeys.config(),
    queryFn: () => client.getVaultConfig(),
  });
}

export function useInitializeVault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (passphrase?: string) => client.initializeVault(passphrase),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.status() });
      toast.success("Vault initialized successfully");
    },
    onError: (err: Error) => toast.error(`Failed to initialize vault: ${err.message}`),
  });
}

export function useUnlockVault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (passphrase: string) => client.unlockVault(passphrase),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.all });
      toast.success("Vault unlocked");
    },
    onError: (err: Error) => toast.error(`Failed to unlock vault: ${err.message}`),
  });
}

export function useLockVault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.lockVault(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.all });
      toast.info("Vault locked");
    },
  });
}

export function useUpdateVaultConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Partial<VaultConfig>) => client.updateVaultConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.config() });
      toast.success("Vault configuration updated");
    },
    onError: (err: Error) => toast.error(`Failed to update config: ${err.message}`),
  });
}

// ---- Connectors ----

export function useConnectors() {
  return useQuery({
    queryKey: vaultKeys.connectors(),
    queryFn: () => client.listConnectors(),
  });
}

export function useConnector(id: string) {
  return useQuery({
    queryKey: vaultKeys.connector(id),
    queryFn: () => client.getConnector(id),
    enabled: !!id,
  });
}

export function useAddConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: {
      type: ConnectorType;
      name: string;
      description?: string;
      sourcePath?: string;
      sourceUrl?: string;
      autoImport?: boolean;
      requirePreview?: boolean;
    }) => client.addConnector(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.connectors() });
      toast.success("Connector added");
    },
    onError: (err: Error) => toast.error(`Failed to add connector: ${err.message}`),
  });
}

export function useRemoveConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.removeConnector(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.connectors() });
      toast.success("Connector removed");
    },
  });
}

export function useToggleConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      enable ? client.enableConnector(id) : client.disableConnector(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.connectors() });
    },
  });
}

// ---- Asset Import ----

export function useImportFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.importFilesDialog(),
    onSuccess: (assets) => {
      qc.invalidateQueries({ queryKey: vaultKeys.assets() });
      qc.invalidateQueries({ queryKey: vaultKeys.status() });
      toast.success(`Imported ${assets.length} file(s)`);
    },
    onError: (err: Error) => toast.error(`Import failed: ${err.message}`),
  });
}

export function useImportFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options?: { recursive?: boolean }) =>
      client.importFolderDialog(options),
    onSuccess: (assets) => {
      qc.invalidateQueries({ queryKey: vaultKeys.assets() });
      qc.invalidateQueries({ queryKey: vaultKeys.status() });
      toast.success(`Imported ${assets.length} file(s) from folder`);
    },
    onError: (err: Error) => toast.error(`Import failed: ${err.message}`),
  });
}

export function useImportText() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      client.importText(name, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.assets() });
      qc.invalidateQueries({ queryKey: vaultKeys.status() });
      toast.success("Text imported to vault");
    },
    onError: (err: Error) => toast.error(`Import failed: ${err.message}`),
  });
}

// ---- Assets ----

export function useVaultAssets(filters?: {
  status?: string;
  modality?: string;
  connectorId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: vaultKeys.assets(filters as Record<string, unknown>),
    queryFn: () => client.listAssets(filters),
  });
}

export function useVaultAsset(id: string) {
  return useQuery({
    queryKey: vaultKeys.asset(id),
    queryFn: () => client.getAsset(id),
    enabled: !!id,
  });
}

export function useAssetContent(id: string) {
  return useQuery({
    queryKey: vaultKeys.assetContent(id),
    queryFn: () => client.getAssetContent(id),
    enabled: !!id,
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{
        name: string;
        description: string;
        tags: string[];
        collections: string[];
      }>;
    }) => client.updateAsset(id, updates),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: vaultKeys.asset(id) });
      qc.invalidateQueries({ queryKey: vaultKeys.assets() });
      toast.success("Asset updated");
    },
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deleteAsset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.assets() });
      qc.invalidateQueries({ queryKey: vaultKeys.status() });
      toast.success("Asset deleted");
    },
  });
}

// ---- Transform ----

export function useTransformJobs() {
  return useQuery({
    queryKey: vaultKeys.transforms(),
    queryFn: () => client.listTransformJobs(),
  });
}

export function useTransformJob(id: string) {
  return useQuery({
    queryKey: vaultKeys.transform(id),
    queryFn: () => client.getTransformJob(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "running" ? 2000 : false;
    },
  });
}

export function useCreateTransformJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: {
      name: string;
      inputAssetIds: string[];
      stages: TransformStageConfig[];
    }) => client.createTransformJob(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.transforms() });
      toast.success("Transform job created");
    },
  });
}

export function useRunTransformJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.runTransformJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.transforms() });
      qc.invalidateQueries({ queryKey: vaultKeys.assets() });
      toast.success("Transform job completed");
    },
    onError: (err: Error) => toast.error(`Transform failed: ${err.message}`),
  });
}

// ---- Packages ----

export function usePackages() {
  return useQuery({
    queryKey: vaultKeys.packages(),
    queryFn: () => client.listPackages(),
  });
}

export function useCreatePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: {
      name: string;
      version: string;
      description?: string;
      assetIds: string[];
      publisherWallet?: string;
    }) => client.createPackage(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.packages() });
      qc.invalidateQueries({ queryKey: vaultKeys.assets() });
      toast.success("Package created");
    },
  });
}

// ---- Policy ----

export function useCreatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Parameters<typeof client.createPolicy>[0]) =>
      client.createPolicy(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.policies() });
      toast.success("Policy created");
    },
  });
}

// ---- Publish ----

export function usePublishBundles() {
  return useQuery({
    queryKey: vaultKeys.bundles(),
    queryFn: () => client.listPublishBundles(),
  });
}

export function useCreatePublishBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Parameters<typeof client.createPublishBundle>[0]) =>
      client.createPublishBundle(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vaultKeys.bundles() });
      toast.success("Publish bundle created — ready for JoyMarketplace!");
    },
  });
}

// ---- Audit ----

export function useVaultAuditLog(limit?: number) {
  return useQuery({
    queryKey: vaultKeys.audit(),
    queryFn: () => client.getAuditLog(limit),
  });
}
