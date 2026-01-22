import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Shield,
  Eye,
  EyeOff,
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  Copy,
  ExternalLink,
  Info,
} from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { showSuccess, showError } from "@/lib/toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface VaultSettingsData {
  supabaseUrl: string;
  hasAnonKey: boolean;
  maskedAnonKey: string;
}

interface VaultTestResult {
  success: boolean;
  status: "connected" | "needs_login" | "invalid_url" | "invalid_key" | "error";
  message: string;
}

interface VaultDiagnostics {
  timestamp: string;
  supabaseUrl: string;
  hasAnonKey: boolean;
  maskedAnonKey: string;
  isAuthenticated: boolean;
  organizationName: string | null;
  lastError: string | null;
}

type ConnectionStatus =
  | "unknown"
  | "connected"
  | "needs_login"
  | "invalid_url"
  | "invalid_key"
  | "error";

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { color: string; bgColor: string; label: string }
> = {
  unknown: {
    color: "text-gray-500",
    bgColor: "bg-gray-100 dark:bg-gray-800",
    label: "Not tested",
  },
  connected: {
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/30",
    label: "Connected",
  },
  needs_login: {
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    label: "Needs login",
  },
  invalid_url: {
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-100 dark:bg-red-900/30",
    label: "Invalid URL",
  },
  invalid_key: {
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-100 dark:bg-red-900/30",
    label: "Invalid key",
  },
  error: {
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-100 dark:bg-red-900/30",
    label: "Error",
  },
};

export function VaultSettings() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("unknown");
  const [statusMessage, setStatusMessage] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Fetch current settings
  const { data: settings, isLoading } = useQuery<VaultSettingsData>({
    queryKey: ["vault-settings"],
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<VaultSettingsData>("vault:get-settings");
    },
  });

  // Initialize form with current settings
  useEffect(() => {
    if (settings) {
      setUrl(settings.supabaseUrl);
      // Don't populate the key field - user must re-enter for security
    }
  }, [settings]);

  // Save settings mutation
  const saveMutation = useMutation({
    mutationFn: async (params: {
      supabaseUrl: string;
      supabaseAnonKey: string;
    }) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<{ success: boolean; error?: string }>(
        "vault:save-settings",
        params,
      );
    },
    onSuccess: (result) => {
      if (result.success) {
        showSuccess("Vault settings saved");
        setHasUnsavedChanges(false);
        setAnonKey(""); // Clear key after save
        queryClient.invalidateQueries({ queryKey: ["vault-settings"] });
        queryClient.invalidateQueries({ queryKey: ["vault-config"] });
        setConnectionStatus("unknown");
      } else {
        showError(result.error || "Failed to save settings");
      }
    },
    onError: (error: Error) => {
      showError(error.message || "Failed to save settings");
    },
  });

  // Test connection mutation
  const testMutation = useMutation({
    mutationFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<VaultTestResult>("vault:test-connection");
    },
    onSuccess: (result) => {
      setConnectionStatus(result.status);
      setStatusMessage(result.message);
      if (result.success) {
        showSuccess(result.message);
      } else {
        showError(result.message);
      }
    },
    onError: (error: Error) => {
      setConnectionStatus("error");
      setStatusMessage(error.message);
      showError(error.message);
    },
  });

  // Copy diagnostics
  const handleCopyDiagnostics = async () => {
    try {
      const ipcClient = IpcClient.getInstance();
      const diagnostics = await ipcClient.invoke<VaultDiagnostics>(
        "vault:get-diagnostics",
      );

      const report = `
Vault Diagnostics Report
========================
Timestamp: ${diagnostics.timestamp}
Supabase URL: ${diagnostics.supabaseUrl}
Has Anon Key: ${diagnostics.hasAnonKey}
Masked Key: ${diagnostics.maskedAnonKey}
Authenticated: ${diagnostics.isAuthenticated}
Organization: ${diagnostics.organizationName || "None"}
Last Error: ${diagnostics.lastError || "None"}
`.trim();

      await navigator.clipboard.writeText(report);
      showSuccess("Diagnostics copied to clipboard");
    } catch {
      showError("Failed to copy diagnostics");
    }
  };

  const handleSave = () => {
    if (!url.trim()) {
      showError("Supabase URL is required");
      return;
    }
    if (!anonKey.trim() && !settings?.hasAnonKey) {
      showError("Publishable key is required");
      return;
    }

    // If no new key entered but one exists, only update URL
    const keyToSave = anonKey.trim() || "";
    if (!keyToSave && settings?.hasAnonKey) {
      showError("Enter the publishable key to update settings");
      return;
    }

    saveMutation.mutate({
      supabaseUrl: url.trim(),
      supabaseAnonKey: keyToSave,
    });
  };

  const handleUrlChange = (value: string) => {
    setUrl(value);
    setHasUnsavedChanges(true);
    setConnectionStatus("unknown");
  };

  const handleKeyChange = (value: string) => {
    setAnonKey(value);
    setHasUnsavedChanges(true);
    setConnectionStatus("unknown");
  };

  const statusConfig = STATUS_CONFIG[connectionStatus];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading Vault settings...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-blue-500" />
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Vault Configuration
          </h3>
          <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 rounded">
            Beta
          </span>
        </div>
        <div
          className={`px-2 py-1 text-xs font-medium rounded ${statusConfig.bgColor} ${statusConfig.color}`}
        >
          {statusConfig.label}
        </div>
      </div>

      {/* Status message */}
      {statusMessage && (
        <div
          className={`p-2 text-xs rounded-md flex items-center gap-2 ${statusConfig.bgColor}`}
        >
          {connectionStatus === "connected" ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : connectionStatus === "needs_login" ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          ) : (
            <X className="h-3.5 w-3.5 text-red-500" />
          )}
          <span className={statusConfig.color}>{statusMessage}</span>
        </div>
      )}

      {/* URL Input */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
          Supabase Project URL
        </label>
        <Input
          type="url"
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="https://your-project.supabase.co"
          className="text-sm"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Find this in your Supabase Dashboard → Settings → API
        </p>
      </div>

      {/* Key Input */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
          Publishable Key (anon key)
        </label>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            value={anonKey}
            onChange={(e) => handleKeyChange(e.target.value)}
            placeholder={
              settings?.hasAnonKey
                ? `Current: ${settings.maskedAnonKey}`
                : "eyJhbGciOiJIUzI1NiIs..."
            }
            className="text-sm pr-10 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {showKey ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Use the <strong>anon/public</strong> key, NOT the service_role key.
          Find it in Supabase Dashboard → Settings → API → Project API keys.
        </p>
      </div>

      {/* Help note */}
      <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-md flex items-start gap-2">
        <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-700 dark:text-blue-300">
          <p>
            The publishable key is safe for client use with Row Level Security.
          </p>
          <p className="mt-1 text-blue-600 dark:text-blue-400">
            Never use or share your service_role key.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending || !hasUnsavedChanges}
            size="sm"
            className="flex items-center gap-2"
          >
            {saveMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Save
          </Button>
          <Button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            {testMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            Test Connection
          </Button>
        </div>

        <Button
          onClick={handleCopyDiagnostics}
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 text-gray-500"
        >
          <Copy className="h-4 w-4" />
          Copy Diagnostics
        </Button>
      </div>
    </div>
  );
}
