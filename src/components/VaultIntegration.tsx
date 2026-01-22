import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Shield, Info, Settings } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { showSuccess, showError } from "@/lib/toast";
import { useQuery } from "@tanstack/react-query";
import { VaultBackupList } from "./vault/VaultBackupList";
import { VaultSettings } from "./vault/VaultSettings";
import { VaultAuth } from "./vault/VaultAuth";

interface VaultStatus {
  isAuthenticated: boolean;
  organizationName?: string;
}

interface VaultConfig {
  url: string;
  configured: boolean;
}

type VaultAuthReason =
  | "AUTHENTICATED"
  | "NO_SESSION"
  | "SESSION_EXPIRED"
  | "TOKEN_REFRESH_FAILED"
  | "CONFIG_MISSING";

interface VaultAuthStatus {
  isAuthenticated: boolean;
  reason: VaultAuthReason;
  userEmail?: string;
  expiresAt?: number;
}

export function VaultIntegration() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Get vault status
  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery<VaultStatus>({
    queryKey: ["vault-status"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<VaultStatus>("vault:get-status");
    },
  });

  // Get vault config
  const { data: config } = useQuery<VaultConfig>({
    queryKey: ["vault-config"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<VaultConfig>("vault:get-config");
    },
  });

  // Get vault auth status (for Vault-specific auth)
  const { data: authStatus } = useQuery<VaultAuthStatus>({
    queryKey: ["vault-auth-status"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<VaultAuthStatus>("vault:auth-status");
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

  // Primary auth: Vault project auth (email/password)
  // This is required for backup operations
  const isVaultAuthenticated = authStatus?.isAuthenticated ?? false;
  // Note: authReason is available via authStatus?.reason if needed for debugging

  // Secondary: Supabase org connection (management API - separate from Vault)
  const hasSupabaseOrgConnection = status?.isAuthenticated ?? false;

  // If not configured, show only the configuration UI
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

        {/* Configuration UI */}
        <div className="mt-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
          <VaultSettings />
        </div>
      </div>
    );
  }

  // Configured but not authenticated - show config + auth UI
  // Always show VaultAuth form when vault auth is missing
  if (!isVaultAuthenticated) {
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
          <Button
            onClick={() => setShowSettings(!showSettings)}
            variant="ghost"
            size="sm"
            className="flex items-center gap-2"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        {/* Vault Auth UI - Always show when not authenticated */}
        <div className="mt-4">
          <VaultAuth />
        </div>

        {/* Supabase Org Connection Status (if connected) */}
        {hasSupabaseOrgConnection && status?.organizationName && (
          <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-md">
            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Supabase Org: {status.organizationName} (separate from Vault auth)
            </p>
          </div>
        )}

        {/* Collapsible Settings Panel */}
        {showSettings && (
          <div className="mt-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
            <VaultSettings />
          </div>
        )}
      </div>
    );
  }

  // Fully authenticated - show full UI
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
            Vault Auth: {authStatus?.userEmail || "Connected"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowSettings(!showSettings)}
            variant="ghost"
            size="sm"
            className="flex items-center gap-2"
          >
            <Settings className="h-4 w-4" />
          </Button>
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
      </div>

      {/* Settings Panel (collapsible) */}
      {showSettings && (
        <div className="mt-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
          <VaultSettings />
        </div>
      )}

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
