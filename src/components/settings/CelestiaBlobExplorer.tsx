/**
 * Celestia Blob Explorer
 *
 * UI component for viewing, submitting, and verifying blobs on Celestia.
 * Data is always displayed as hashes — never raw content.
 */

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Globe,
  Hash,
  Lock,
  Unlock,
  Upload,
  RefreshCw,
  ShieldCheck,
  Database,
  Layers,
  ArrowUpRight,
  Copy,
  Settings,
  ChevronDown,
  Wallet,
  Server,
  Sparkles,
  RotateCcw,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCelestiaBlobs } from "@/hooks/useCelestiaBlobs";
import type { BlobSubmission, CelestiaConfig } from "@/ipc/celestia_blob_client";
import { toast } from "sonner";

// =============================================================================
// HELPERS
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function truncateHash(hash: string, chars = 12): string {
  if (hash.length <= chars * 2) return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}

function timeSince(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000,
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// =============================================================================
// BLOB ROW
// =============================================================================

function BlobRow({
  blob,
  onVerify,
  isVerifying,
}: {
  blob: BlobSubmission;
  onVerify: (hash: string) => void;
  isVerifying: boolean;
}) {
  const copyHash = () => {
    navigator.clipboard.writeText(blob.contentHash);
    toast.success("Hash copied");
  };

  return (
    <div className="flex items-center justify-between py-3 px-2 hover:bg-muted/30 rounded-md transition-colors">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className={cn(
            "p-1.5 rounded-md",
            blob.encrypted
              ? "bg-purple-500/10 text-purple-500"
              : "bg-blue-500/10 text-blue-500",
          )}
        >
          {blob.encrypted ? (
            <Lock className="h-4 w-4" />
          ) : (
            <Hash className="h-4 w-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              onClick={copyHash}
              className="font-mono text-sm truncate hover:text-primary cursor-pointer"
              title={blob.contentHash}
            >
              {truncateHash(blob.contentHash)}
            </button>
            <Copy className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            {blob.label && <span>{blob.label}</span>}
            <span>Height: {blob.height}</span>
            <span>{formatBytes(blob.originalSize)}</span>
            <span>{timeSince(blob.submittedAt)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {blob.dataType && (
          <Badge variant="outline" className="text-xs">
            {blob.dataType}
          </Badge>
        )}
        {blob.encrypted && (
          <Badge
            variant="outline"
            className="text-xs bg-purple-500/5 text-purple-500 border-purple-500/20"
          >
            Encrypted
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onVerify(blob.contentHash)}
          disabled={isVerifying}
          title="Verify integrity"
        >
          <ShieldCheck className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// NODE SETUP FORM
// =============================================================================

function NodeSetupForm({
  config,
  onSave,
  onGenerateNamespace,
  onReset,
  isSaving,
  isGenerating,
}: {
  config?: CelestiaConfig;
  onSave: (updates: Partial<CelestiaConfig>) => Promise<CelestiaConfig>;
  onGenerateNamespace: (id: string) => Promise<{ namespace: string; namespaceId: string }>;
  onReset: () => void;
  isSaving: boolean;
  isGenerating: boolean;
}) {
  const [rpcUrl, setRpcUrl] = useState(config?.rpcUrl ?? "http://localhost:26658");
  const [walletAddress, setWalletAddress] = useState(config?.walletAddress ?? "");
  const [namespaceId, setNamespaceId] = useState(config?.namespaceId ?? "");
  const [namespace, setNamespace] = useState(config?.namespace ?? "");
  const [network, setNetwork] = useState(config?.network ?? "celestia");
  const [gasPrice, setGasPrice] = useState(String(config?.gasPrice ?? 0.002));
  const [authToken, setAuthToken] = useState(config?.authToken ?? "");
  const [newNamespaceId, setNewNamespaceId] = useState("");

  // Sync form when config loads
  useEffect(() => {
    if (config) {
      setRpcUrl(config.rpcUrl);
      setWalletAddress(config.walletAddress);
      setNamespaceId(config.namespaceId ?? "");
      setNamespace(config.namespace);
      setNetwork(config.network);
      setGasPrice(String(config.gasPrice));
      setAuthToken(config.authToken ?? "");
    }
  }, [config]);

  const handleGenerateNamespace = async () => {
    if (!newNamespaceId.trim()) {
      toast.error("Enter a namespace ID (e.g. myproject123)");
      return;
    }
    try {
      const result = await onGenerateNamespace(newNamespaceId.trim());
      setNamespace(result.namespace);
      setNamespaceId(result.namespaceId);
      setNewNamespaceId("");
    } catch (err) {
      // Error handled by mutation
    }
  };

  const handleSave = async () => {
    // Basic validation
    if (!walletAddress.startsWith("celestia1")) {
      toast.error("Wallet address must start with 'celestia1'");
      return;
    }
    if (!namespace) {
      toast.error("Namespace is required — generate one or use the default");
      return;
    }

    try {
      await onSave({
        rpcUrl,
        walletAddress,
        namespace,
        namespaceId,
        network,
        gasPrice: parseFloat(gasPrice) || 0.002,
        authToken: authToken || undefined,
      });
    } catch (err) {
      // Error handled by mutation
    }
  };

  const copyNamespace = () => {
    navigator.clipboard.writeText(namespace);
    toast.success("Namespace copied (base64)");
  };

  return (
    <div className="space-y-4">
      {/* RPC Endpoint */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="rpc-url" className="flex items-center gap-1">
            <Server className="h-3 w-3" />
            RPC Endpoint
          </Label>
          <Input
            id="rpc-url"
            placeholder="http://localhost:26658"
            value={rpcUrl}
            onChange={(e) => setRpcUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Your Celestia light node RPC URL
          </p>
        </div>

        <div>
          <Label htmlFor="network">Network</Label>
          <Input
            id="network"
            placeholder="celestia (mainnet) or mocha (testnet)"
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            celestia = mainnet, mocha = testnet
          </p>
        </div>
      </div>

      {/* Wallet Address */}
      <div>
        <Label htmlFor="wallet" className="flex items-center gap-1">
          <Wallet className="h-3 w-3" />
          Wallet Address
        </Label>
        <Input
          id="wallet"
          placeholder="celestia1..."
          value={walletAddress}
          onChange={(e) => setWalletAddress(e.target.value)}
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Your Celestia wallet address (bech32 format)
        </p>
      </div>

      {/* Namespace Section */}
      <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            Namespace
          </Label>
          {namespaceId && (
            <Badge variant="secondary" className="text-xs font-mono">
              {namespaceId}
            </Badge>
          )}
        </div>

        {/* Current namespace */}
        {namespace && (
          <div className="flex items-center gap-2">
            <Input
              value={namespace}
              readOnly
              className="font-mono text-xs bg-background"
            />
            <Button variant="outline" size="sm" onClick={copyNamespace}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Generate new namespace */}
        <div className="flex items-center gap-2">
          <Input
            placeholder="Enter namespace ID (e.g. myproject)"
            value={newNamespaceId}
            onChange={(e) => setNewNamespaceId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
            maxLength={10}
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleGenerateNamespace}
            disabled={isGenerating || !newNamespaceId.trim()}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1" />
            )}
            Generate
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Create a unique namespace for your blobs. Max 10 alphanumeric characters.
        </p>
      </div>

      {/* Advanced Settings */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="gas-price">Gas Price (TIA)</Label>
          <Input
            id="gas-price"
            type="number"
            step="0.001"
            min="0.001"
            placeholder="0.002"
            value={gasPrice}
            onChange={(e) => setGasPrice(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="auth-token">Auth Token (optional)</Label>
          <Input
            id="auth-token"
            type="password"
            placeholder="Node auth token if required"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Reset to Defaults
        </Button>

        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Configuration
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// SUBMIT FORM
// =============================================================================

function SubmitBlobForm({
  onSubmit,
  isSubmitting,
}: {
  onSubmit: (params: {
    data: string;
    label?: string;
    dataType?: string;
    encrypt?: boolean;
  }) => void;
  isSubmitting: boolean;
}) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [dataType, setDataType] = useState("document");
  const [encrypt, setEncrypt] = useState(true);

  const handleSubmit = () => {
    if (!text.trim()) {
      toast.error("Enter data to submit");
      return;
    }
    const data = btoa(unescape(encodeURIComponent(text)));
    onSubmit({ data, label: label || undefined, dataType, encrypt });
    setText("");
    setLabel("");
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="blob-label">Label</Label>
          <Input
            id="blob-label"
            placeholder="e.g. agent-config-v2"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="blob-type">Data Type</Label>
          <Input
            id="blob-type"
            placeholder="e.g. document, dataset"
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="blob-data">Data (will be hashed before submission)</Label>
        <Textarea
          id="blob-data"
          placeholder="Paste JSON, text, or any data. It will be SHA-256 hashed and submitted as an encoded blob — never as raw data."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch
            id="blob-encrypt"
            checked={encrypt}
            onCheckedChange={setEncrypt}
          />
          <Label htmlFor="blob-encrypt" className="text-sm">
            Encrypt before submission (AES-256-GCM)
          </Label>
        </div>

        <Button onClick={handleSubmit} disabled={isSubmitting || !text.trim()}>
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          Submit Blob
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function CelestiaBlobExplorer() {
  const [setupOpen, setSetupOpen] = useState(false);

  const {
    isAvailable,
    nodeHeight,
    isSyncing,
    balance,
    walletAddress,
    network,
    status,
    statusLoading,
    config,
    configLoading,
    blobs,
    blobsLoading,
    stats,
    statsLoading,
    submitBlob,
    verifyBlob,
    updateConfig,
    generateNamespace,
    resetConfig,
    isSubmitting,
    isVerifying,
    isSavingConfig,
    isGeneratingNamespace,
    refresh,
  } = useCelestiaBlobs();

  const copyWallet = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      toast.success("Wallet address copied");
    }
  };

  const namespaceId = config?.namespaceId ?? "joy80mvp12";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-purple-500" />
              Celestia Data Availability
            </CardTitle>
            <CardDescription className="mt-1">
              {network ? (
                <span className="capitalize">{network}</span>
              ) : (
                "Celestia"
              )}{" "}
              — large data is exposed as hashed blobs, never as raw data
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant={isAvailable ? "default" : "destructive"}
              className={cn(
                "text-xs",
                isAvailable
                  ? "bg-green-500/10 text-green-500 border-green-500/20"
                  : "",
              )}
            >
              {statusLoading ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : isAvailable ? (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              ) : (
                <XCircle className="h-3 w-3 mr-1" />
              )}
              {isAvailable ? "Connected" : "Offline"}
            </Badge>
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Node Setup (Collapsible) */}
        <Collapsible open={setupOpen} onOpenChange={setSetupOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between"
              size="sm"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Node Setup & Configuration
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  setupOpen && "rotate-180",
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <NodeSetupForm
              config={config}
              onSave={updateConfig}
              onGenerateNamespace={generateNamespace}
              onReset={resetConfig}
              isSaving={isSavingConfig}
              isGenerating={isGeneratingNamespace}
            />
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Node Status Bar */}
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold text-purple-500">
              {nodeHeight?.toLocaleString() ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground">Block Height</div>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold">
              {stats?.totalBlobs?.toLocaleString() ?? "0"}
            </div>
            <div className="text-xs text-muted-foreground">Blobs Submitted</div>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold">
              {stats ? formatBytes(stats.totalBytes) : "0 B"}
            </div>
            <div className="text-xs text-muted-foreground">Total Data</div>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <div className="text-2xl font-bold">
              {balance ? `${(Number(balance.amount) / 1e6).toFixed(2)}` : "—"}
            </div>
            <div className="text-xs text-muted-foreground">TIA Balance</div>
          </div>
        </div>

        {isSyncing && (
          <div className="flex items-center gap-2 text-sm text-amber-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Node is syncing...
          </div>
        )}

        <Separator />

        {/* Submit Blob */}
        <div>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4" />
            Submit Hashed Blob
          </h3>
          <SubmitBlobForm onSubmit={submitBlob} isSubmitting={isSubmitting} />
        </div>

        <Separator />

        {/* Blob Index */}
        <div>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Database className="h-4 w-4" />
            Blob Index
            {blobs.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {blobs.length}
              </Badge>
            )}
          </h3>

          {blobsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : blobs.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              <Layers className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>No blobs submitted yet</p>
              <p className="text-xs mt-1">
                Submit data above to create your first hashed blob on Celestia
              </p>
            </div>
          ) : (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {blobs.map((blob) => (
                <BlobRow
                  key={blob.contentHash}
                  blob={blob}
                  onVerify={verifyBlob}
                  isVerifying={isVerifying}
                />
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Info Footer */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="flex items-center gap-1">
            <Lock className="h-3 w-3" />
            All data is SHA-256 hashed before submission. Raw data never leaves
            your device.
          </p>
          <p className="flex items-center gap-1">
            <Unlock className="h-3 w-3" />
            Optional AES-256-GCM encryption adds a second layer before Celestia
            submission.
          </p>
          <p className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            Network:{" "}
            <span className="font-mono capitalize">
              {network ?? "celestia"}
            </span>
            {" "}— Namespace:{" "}
            <span className="font-mono">{namespaceId}</span>
          </p>
          {walletAddress && (
            <p className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              Wallet:{" "}
              <button
                onClick={copyWallet}
                className="font-mono hover:text-primary cursor-pointer"
                title={walletAddress}
              >
                {walletAddress.slice(0, 16)}...{walletAddress.slice(-8)}
              </button>
              <Copy className="h-3 w-3 ml-0.5" />
            </p>
          )}
          <p className="flex items-center gap-1">
            <Server className="h-3 w-3" />
            RPC:{" "}
            <span className="font-mono">{config?.rpcUrl ?? "localhost:26658"}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default CelestiaBlobExplorer;
