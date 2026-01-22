import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Shield, Info, AlertTriangle } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { showSuccess, showError } from "@/lib/toast";
import { useQuery } from "@tanstack/react-query";
import { VaultBackupList } from "./vault/VaultBackupList";

interface VaultStatus {
  isAuthenticated: boolean;
  organizationName?: string;
}

interface VaultConfig {
  url: string;
  configured: boolean;
}

export function VaultIntegration() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get vault status
  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery<VaultStatus>({
    queryKey: ["vault-status"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return (ipcClient as any).invoke("vault:get-status");
    },
  });

  // Get vault config
  const { data: config } = useQuery<VaultConfig>({
    queryKey: ["vault-config"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return (ipcClient as any).invoke("vault:get-config");
    },
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchStatus();
      showSuccess("Vault status refreshed");
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Failed to refresh status",
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  if (statusLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading Vault status...
      </div>
    );
  }

  // Check if Vault is configured
  if (!config?.configured) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Vault (Cloud Backup)
              <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 rounded">
                Beta
              </span>
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Cloud backup and restore for your ABBA AI projects.
            </p>
          </div>
        </div>
        <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-md flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Vault is not configured.
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Set VAULT_SUPABASE_URL and VAULT_SUPABASE_ANON_KEY environment
              variables, or contact your administrator.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Check if user is authenticated
  if (!status?.isAuthenticated) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Vault (Cloud Backup)
              <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 rounded">
                Beta
              </span>
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Cloud backup and restore for your ABBA AI projects.
            </p>
          </div>
        </div>
        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Sign in to Supabase above to enable Vault.
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
              Vault requires authentication to securely store your backups.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Shield className="h-4 w-4 text-green-500" />
            Vault (Cloud Backup)
            <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 rounded">
              Beta
            </span>
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Connected via {status.organizationName || "Supabase"}
          </p>
        </div>
        <Button
          onClick={handleRefresh}
          variant="outline"
          size="sm"
          disabled={isRefreshing}
          className="flex items-center gap-2"
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Requirements Note */}
      <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-md">
        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Info className="h-3 w-3" />
          Private storage · Per-user access · Signed URLs expire in ~2h
        </p>
      </div>

      {/* Backup List */}
      <div className="mt-4">
        <VaultBackupList />
      </div>
    </div>
  );
}
