// =============================================================================
// Local Data Vault — Main page: vault overview, storage health, pinned items
// =============================================================================

import { useState } from "react";
import {
  useVaultStatus,
  useVaultConfig,
  useVaultAssets,
  useVaultAuditLog,
  useInitializeVault,
  useUnlockVault,
  useLockVault,
  useImportFiles,
  useImportFolder,
  useImportText,
  useDeleteAsset,
} from "../../hooks/useLocalVault";
import { VaultNav } from "./VaultNav";
import { formatBytes } from "../../lib/vault_utils";
import {
  Shield,
  HardDrive,
  Lock,
  Unlock,
  Upload,
  FolderUp,
  FileText,
  Trash2,
  Eye,
  Tag,
  Search,
  RefreshCw,
  Database,
  Layers,
  Package,
  Activity,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

export default function LocalVaultPage() {
  const { data: status, isLoading: statusLoading } = useVaultStatus();
  const { data: config } = useVaultConfig();
  const { data: auditLog } = useVaultAuditLog(10);

  const initVault = useInitializeVault();
  const unlockVault = useUnlockVault();
  const lockVault = useLockVault();
  const importFiles = useImportFiles();
  const importFolder = useImportFolder();
  const importText = useImportText();
  const deleteAsset = useDeleteAsset();

  const [passphrase, setPassphrase] = useState("");
  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");
  const [showTextImport, setShowTextImport] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: assetsResult } = useVaultAssets({ limit: 20, search: searchQuery || undefined });

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not initialized — show setup
  if (!status?.initialized) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Set Up Your Data Vault</h1>
          <p className="text-muted-foreground">
            Your local data vault encrypts and stores your data privately.
            No data leaves your device without your explicit consent.
          </p>
          <div className="space-y-3">
            <input
              type="password"
              placeholder="Create a vault passphrase (optional)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border bg-background"
            />
            <button
              onClick={() => initVault.mutate(passphrase || undefined)}
              disabled={initVault.isPending}
              className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {initVault.isPending ? "Initializing..." : "Initialize Vault"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Locked — show unlock
  if (!status.unlocked && config?.encryptAtRest) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8 text-amber-500" />
          </div>
          <h1 className="text-2xl font-bold">Vault Locked</h1>
          <p className="text-muted-foreground">
            Enter your passphrase to unlock the vault and access your data.
          </p>
          <div className="space-y-3">
            <input
              type="password"
              placeholder="Vault passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") unlockVault.mutate(passphrase);
              }}
              className="w-full px-4 py-2 rounded-lg border bg-background"
            />
            <button
              onClick={() => unlockVault.mutate(passphrase)}
              disabled={unlockVault.isPending}
              className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {unlockVault.isPending ? "Unlocking..." : "Unlock Vault"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const assets = assetsResult?.assets ?? [];
  const totalAssets = assetsResult?.total ?? 0;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Vault Tab Navigation */}
      <VaultNav />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-7 h-7 text-primary" />
            Data Vault
          </h1>
          <p className="text-muted-foreground mt-1">
            Your sovereign, encrypted local data store
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => lockVault.mutate()}
            className="px-3 py-1.5 rounded-lg border text-sm flex items-center gap-1.5 hover:bg-muted"
          >
            <Lock className="w-4 h-4" />
            Lock Vault
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatusCard
          icon={<Database className="w-5 h-5" />}
          label="Total Assets"
          value={String(status.totalAssets)}
          color="text-blue-500"
        />
        <StatusCard
          icon={<HardDrive className="w-5 h-5" />}
          label="Storage Used"
          value={formatBytes(status.totalBytes)}
          color="text-purple-500"
        />
        <StatusCard
          icon={<Layers className="w-5 h-5" />}
          label="Connectors"
          value={String(status.connectorCount)}
          color="text-green-500"
        />
        <StatusCard
          icon={
            status.storageHealth === "healthy" ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )
          }
          label="Storage Health"
          value={status.storageHealth}
          color={status.storageHealth === "healthy" ? "text-emerald-500" : "text-amber-500"}
        />
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => importFiles.mutate()}
          disabled={importFiles.isPending}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          Import Files
        </button>
        <button
          onClick={() => importFolder.mutate({ recursive: true })}
          disabled={importFolder.isPending}
          className="px-4 py-2 rounded-lg border font-medium text-sm flex items-center gap-2 hover:bg-muted disabled:opacity-50"
        >
          <FolderUp className="w-4 h-4" />
          Import Folder
        </button>
        <button
          onClick={() => setShowTextImport(!showTextImport)}
          className="px-4 py-2 rounded-lg border font-medium text-sm flex items-center gap-2 hover:bg-muted"
        >
          <FileText className="w-4 h-4" />
          Capture Text
        </button>
      </div>

      {/* Text Import */}
      {showTextImport && (
        <div className="p-4 border rounded-lg space-y-3 bg-muted/30">
          <input
            placeholder="Title"
            value={textName}
            onChange={(e) => setTextName(e.target.value)}
            className="w-full px-3 py-1.5 rounded border bg-background text-sm"
          />
          <textarea
            placeholder="Paste or type your text content here..."
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            rows={4}
            className="w-full px-3 py-1.5 rounded border bg-background text-sm resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (textName && textContent) {
                  importText.mutate({ name: textName, content: textContent });
                  setTextName("");
                  setTextContent("");
                  setShowTextImport(false);
                }
              }}
              disabled={!textName || !textContent}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              Save to Vault
            </button>
            <button
              onClick={() => setShowTextImport(false)}
              className="px-3 py-1.5 rounded border text-sm hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          placeholder="Search vault assets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2 rounded-lg border bg-background text-sm"
        />
      </div>

      {/* Assets List */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Package className="w-5 h-5" />
          Vault Assets
          <span className="text-sm text-muted-foreground font-normal">({totalAssets})</span>
        </h2>

        {assets.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No assets in vault yet</p>
            <p className="text-sm">Import files, folders, or text to get started</p>
          </div>
        ) : (
          <div className="border rounded-lg divide-y">
            {assets.map((asset) => (
              <div key={asset.id} className="px-4 py-3 flex items-center gap-3 hover:bg-muted/30">
                <ModalityIcon modality={asset.modality} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{asset.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{formatBytes(asset.byteSize)}</span>
                    <span>·</span>
                    <span>{asset.mimeType}</span>
                    <span>·</span>
                    <StatusBadge status={asset.status} />
                    {asset.encrypted && (
                      <>
                        <span>·</span>
                        <Lock className="w-3 h-3 text-green-500" />
                      </>
                    )}
                    {asset.piiDetected && (
                      <>
                        <span>·</span>
                        <span className={asset.piiRedacted ? "text-green-500" : "text-amber-500"}>
                          PII {asset.piiRedacted ? "redacted" : "detected"}
                        </span>
                      </>
                    )}
                  </div>
                  {asset.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {asset.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-primary/10 text-primary">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => deleteAsset.mutate(asset.id)}
                  className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Audit Log */}
      {auditLog && auditLog.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Recent Activity
          </h2>
          <div className="border rounded-lg divide-y text-sm">
            {auditLog.map((entry) => (
              <div key={entry.id} className="px-4 py-2 flex items-center gap-3">
                <AuditIcon action={entry.action} />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{formatAuditAction(entry.action)}</span>
                  {entry.details && (
                    <span className="text-muted-foreground ml-1">— {entry.details}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Sub-components ----

function StatusCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="p-4 border rounded-lg">
      <div className={`${color} mb-2`}>{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function ModalityIcon({ modality }: { modality: string }) {
  const iconClass = "w-4 h-4";
  switch (modality) {
    case "text":
      return <FileText className={`${iconClass} text-blue-500`} />;
    case "image":
      return <Eye className={`${iconClass} text-purple-500`} />;
    case "document":
      return <FileText className={`${iconClass} text-amber-500`} />;
    default:
      return <Database className={`${iconClass} text-muted-foreground`} />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ingested: "text-blue-500",
    processing: "text-amber-500",
    ready: "text-green-500",
    packaged: "text-purple-500",
    published: "text-emerald-500",
    archived: "text-muted-foreground",
    error: "text-destructive",
  };
  return <span className={colors[status] ?? "text-muted-foreground"}>{status}</span>;
}

function AuditIcon({ action }: { action: string }) {
  if (action.includes("import")) return <Upload className="w-4 h-4 text-blue-500" />;
  if (action.includes("transform")) return <RefreshCw className="w-4 h-4 text-purple-500" />;
  if (action.includes("redact") || action.includes("pii")) return <Shield className="w-4 h-4 text-amber-500" />;
  if (action.includes("publish") || action.includes("package")) return <Package className="w-4 h-4 text-green-500" />;
  if (action.includes("delete")) return <Trash2 className="w-4 h-4 text-destructive" />;
  if (action.includes("lock") || action.includes("unlock")) return <Lock className="w-4 h-4 text-muted-foreground" />;
  return <Activity className="w-4 h-4 text-muted-foreground" />;
}

function formatAuditAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


