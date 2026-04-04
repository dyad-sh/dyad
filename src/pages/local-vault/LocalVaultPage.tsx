// =============================================================================
// Local Data Vault — Simplified with 4 inline tabs: Overview, Privacy, Memory, Audit
// =============================================================================

import { useState, lazy, Suspense } from "react";
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
import {
  useVaultIdentity,
  useVaultUnlock,
  useVaultLock as useVaultLockIdentity,
  useVaultPeers,
} from "@/hooks/useDataStudioExtended";
import { formatBytes } from "../../lib/vault_utils";
import {
  Shield,
  HardDrive,
  Lock,
  Upload,
  FolderUp,
  FileText,
  Trash2,
  Eye,
  Search,
  RefreshCw,
  Database,
  Layers,
  Package,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Brain,
  Loader2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const MemoryLearningPage = lazy(() => import("./MemoryLearningPage"));

export default function LocalVaultPage() {
  const { data: status, isLoading: statusLoading } = useVaultStatus();
  const { data: config } = useVaultConfig();

  const initVault = useInitializeVault();
  const unlockVault = useUnlockVault();
  const lockVault = useLockVault();

  const [passphrase, setPassphrase] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

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

  return (
    <div className="flex flex-col h-full w-full" data-joy-assist="data-vault-page">
      {/* Header */}
      <div className="shrink-0 border-b bg-gradient-to-r from-amber-500/5 via-orange-500/5 to-yellow-500/5 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20">
              <HardDrive className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Data Vault</h1>
              <p className="text-sm text-muted-foreground">
                Your sovereign, encrypted local data store
              </p>
            </div>
          </div>
          <button
            onClick={() => lockVault.mutate()}
            className="px-3 py-1.5 rounded-lg border text-sm flex items-center gap-1.5 hover:bg-muted"
          >
            <Lock className="w-4 h-4" />
            Lock Vault
          </button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="shrink-0 border-b px-6">
          <TabsList className="h-11 bg-transparent p-0 gap-1">
            <TabsTrigger value="overview" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <HardDrive className="h-3.5 w-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="privacy" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Shield className="h-3.5 w-3.5" />
              Privacy
            </TabsTrigger>
            <TabsTrigger value="memory" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Brain className="h-3.5 w-3.5" />
              Memory
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Activity className="h-3.5 w-3.5" />
              Audit
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6">
            <TabsContent value="overview" className="mt-0">
              <OverviewContent status={status} />
            </TabsContent>
            <TabsContent value="privacy" className="mt-0">
              <PrivacyContent />
            </TabsContent>
            <TabsContent value="memory" className="mt-0">
              <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
                <MemoryLearningPage />
              </Suspense>
            </TabsContent>
            <TabsContent value="audit" className="mt-0">
              <AuditContent />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );

  // biome-ignore lint/correctness/noUnreachable: This is never reached; it's a section boundary marker
  function OverviewContent({ status: vaultStatus }: { status: any }) {
    const importFiles2 = useImportFiles();
    const importFolder2 = useImportFolder();
    const importText2 = useImportText();
    const deleteAsset2 = useDeleteAsset();

    const [textName, setTextName] = useState("");
    const [textContent, setTextContent] = useState("");
    const [showTextImport, setShowTextImport] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const { data: assetsResult } = useVaultAssets({ limit: 20, search: searchQuery || undefined });
    const assets = assetsResult?.assets ?? [];
    const totalAssets = assetsResult?.total ?? 0;

    return (
      <div className="space-y-6">
        {/* Status Cards */}
        <div className="grid grid-cols-4 gap-4">
          <VaultStatusCard
            icon={<Database className="w-5 h-5" />}
            label="Total Assets"
            value={String(vaultStatus.totalAssets)}
            color="text-blue-500"
          />
          <VaultStatusCard
            icon={<HardDrive className="w-5 h-5" />}
            label="Storage Used"
            value={formatBytes(vaultStatus.totalBytes)}
            color="text-purple-500"
          />
          <VaultStatusCard
            icon={<Layers className="w-5 h-5" />}
            label="Connectors"
            value={String(vaultStatus.connectorCount)}
            color="text-green-500"
          />
          <VaultStatusCard
            icon={
              vaultStatus.storageHealth === "healthy" ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )
            }
            label="Storage Health"
            value={vaultStatus.storageHealth}
            color={vaultStatus.storageHealth === "healthy" ? "text-emerald-500" : "text-amber-500"}
          />
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => importFiles2.mutate()}
            disabled={importFiles2.isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            Import Files
          </button>
          <button
            onClick={() => importFolder2.mutate({ recursive: true })}
            disabled={importFolder2.isPending}
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
                    importText2.mutate({ name: textName, content: textContent });
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
                      <AssetStatusBadge status={asset.status} />
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
                    onClick={() => deleteAsset2.mutate(asset.id)}
                    className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
}

// ---- Privacy Tab ----

function PrivacyContent() {
  const [passphrase, setPassphrase] = useState("");
  const { data: identity, isError: identityError } = useVaultIdentity();
  const { data: peers } = useVaultPeers();
  const unlock = useVaultUnlock();
  const lockIdentity = useVaultLockIdentity();

  const isLocked = identityError;

  const handleUnlock = () => {
    if (!passphrase) return;
    unlock.mutate(passphrase);
    setPassphrase("");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Vault Identity
          </CardTitle>
          <CardDescription>Cryptographic identity and encrypted storage</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLocked ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-yellow-600">
                <Lock className="h-4 w-4" />
                <span>Vault identity is locked</span>
              </div>
              <Input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase"
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              />
              <Button onClick={handleUnlock} disabled={unlock.isPending}>
                Unlock Vault
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span>Vault identity unlocked</span>
              </div>

              {identity?.identity && (
                <div className="p-3 bg-muted rounded-md">
                  <p className="text-xs font-medium mb-1">Public Key</p>
                  <code className="text-xs break-all">
                    {identity.identity.publicKey.substring(0, 64)}...
                  </code>
                </div>
              )}

              <Button variant="outline" onClick={() => lockIdentity.mutate()}>
                Lock Identity
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!isLocked && peers?.peers && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trusted Peers</CardTitle>
          </CardHeader>
          <CardContent>
            {peers.peers.length === 0 ? (
              <p className="text-muted-foreground text-sm">No peers added yet</p>
            ) : (
              <div className="space-y-2">
                {peers.peers.map((peer, i) => (
                  <div key={i} className="flex items-center justify-between p-2 border rounded">
                    <div>
                      <p className="font-medium">{peer.name}</p>
                      <p className="text-xs text-muted-foreground">{peer.peerId}</p>
                    </div>
                    {peer.trusted && <Badge variant="secondary">Trusted</Badge>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Audit Tab ----

function AuditContent() {
  const { data: auditLog } = useVaultAuditLog(50);

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Activity className="w-5 h-5" />
        Activity Log
      </h2>
      {auditLog && auditLog.length > 0 ? (
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
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No activity yet</p>
        </div>
      )}
    </div>
  );
}

// ---- Sub-components ----

function VaultStatusCard({
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

function AssetStatusBadge({ status }: { status: string }) {
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


