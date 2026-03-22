// =============================================================================
// Packaging & Publish Page — CID packaging + policy + marketplace publishing
// =============================================================================

import { useState } from "react";
import {
  useVaultAssets,
  usePackages,
  useCreatePackage,
  useCreatePolicy,
  useCreatePublishBundle,
  usePublishBundles,
} from "../../hooks/useLocalVault";
import { VaultNav, VaultLockGate } from "./VaultNav";
import { formatBytes } from "../../lib/vault_utils";
import {
  Package,
  FileCheck,
  Shield,
  Send,
  Plus,
  CheckCircle2,
  Lock,
  Globe,
  DollarSign,
  Tag,
  ArrowRight,
  Loader2,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

export default function PackagingPage() {
  const { data: assetsResult } = useVaultAssets({ status: "ready", limit: 200 });
  const { data: packages = [] } = usePackages();
  const { data: bundles = [] } = usePublishBundles();
  const createPackage = useCreatePackage();
  const createPolicy = useCreatePolicy();
  const createBundle = useCreatePublishBundle();

  const readyAssets = assetsResult?.assets ?? [];

  // Packaging state
  const [step, setStep] = useState<"select" | "policy" | "publish" | "done">("select");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [pkgName, setPkgName] = useState("");
  const [pkgVersion, setPkgVersion] = useState("1.0.0");
  const [pkgDescription, setPkgDescription] = useState("");
  const [publisherWallet, setPublisherWallet] = useState("");

  // Policy state
  const [pricingModel, setPricingModel] = useState("free");
  const [priceAmount, setPriceAmount] = useState(0);
  const [license, setLicense] = useState("cc-by-4.0");
  const [sovereignExit, setSovereignExit] = useState(false);
  const [btcAddress, setBtcAddress] = useState("");

  // Created IDs
  const [createdPackageId, setCreatedPackageId] = useState<string | null>(null);
  const [createdPolicyId, setCreatedPolicyId] = useState<string | null>(null);
  const [createdBundleId, setCreatedBundleId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const toggleAsset = (id: string) => {
    setSelectedAssetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleCreatePackage = async () => {
    if (!pkgName || selectedAssetIds.length === 0) return;
    setIsProcessing(true);
    try {
      const pkg = await createPackage.mutateAsync({
        name: pkgName,
        version: pkgVersion,
        description: pkgDescription,
        assetIds: selectedAssetIds,
        publisherWallet: publisherWallet || undefined,
      });
      setCreatedPackageId(pkg.id);
      setStep("policy");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreatePolicy = async () => {
    if (!createdPackageId) return;
    setIsProcessing(true);
    try {
      const policy = await createPolicy.mutateAsync({
        manifestId: createdPackageId,
        licenseTiers: [
          { tier: "personal", enabled: true, description: "Personal use", price: 0 },
          { tier: "commercial", enabled: pricingModel !== "free", price: priceAmount, currency: "USD", description: "Commercial license" },
          { tier: "enterprise", enabled: false, description: "Enterprise license" },
        ],
        pricingModel,
        priceAmount: priceAmount || undefined,
        priceCurrency: "USD",
        btcTaprootAddress: btcAddress || undefined,
        sovereignExitEnabled: sovereignExit,
        publisherWallet: publisherWallet || undefined,
      });
      setCreatedPolicyId(policy.id);
      setStep("publish");
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePublish = async () => {
    if (!createdPackageId || !createdPolicyId) return;
    setIsProcessing(true);
    try {
      const bundle = await createBundle.mutateAsync({
        manifestId: createdPackageId,
        policyId: createdPolicyId,
        listing: {
          name: pkgName,
          description: pkgDescription,
          category: "dataset",
          tags: ["data", "curated"],
          license,
          pricingModel,
          price: priceAmount || undefined,
          currency: "USD",
        },
        publisherWallet: publisherWallet || "0x0000000000000000000000000000000000000000",
      });
      setCreatedBundleId(bundle.id);
      setStep("done");
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setStep("select");
    setSelectedAssetIds([]);
    setPkgName("");
    setPkgVersion("1.0.0");
    setPkgDescription("");
    setCreatedPackageId(null);
    setCreatedPolicyId(null);
    setCreatedBundleId(null);
  };

  return (
    <VaultLockGate>
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Vault Tab Navigation */}
      <VaultNav />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="w-7 h-7 text-primary" />
          Packaging & Publishing
        </h1>
        <p className="text-muted-foreground mt-1">
          Package your processed data with CIDs + policies, then publish to JoyMarketplace
        </p>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2">
        {[
          { key: "select", label: "1. Package", icon: <Package className="w-4 h-4" /> },
          { key: "policy", label: "2. Policy", icon: <Shield className="w-4 h-4" /> },
          { key: "publish", label: "3. Publish", icon: <Send className="w-4 h-4" /> },
          { key: "done", label: "4. Done", icon: <CheckCircle2 className="w-4 h-4" /> },
        ].map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
                step === s.key
                  ? "bg-primary text-primary-foreground"
                  : (["select", "policy", "publish", "done"].indexOf(step) >
                    ["select", "policy", "publish", "done"].indexOf(s.key))
                  ? "bg-green-500/10 text-green-500"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {s.icon}
              {s.label}
            </div>
            {i < 3 && <ArrowRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="max-w-5xl">
        {step === "select" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Package Name</label>
              <input
                value={pkgName}
                onChange={(e) => setPkgName(e.target.value)}
                placeholder="My Curated Dataset"
                className="w-full px-3 py-2 rounded-lg border bg-background"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Version</label>
                <input
                  value={pkgVersion}
                  onChange={(e) => setPkgVersion(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Publisher Wallet</label>
                <input
                  value={publisherWallet}
                  onChange={(e) => setPublisherWallet(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={pkgDescription}
                onChange={(e) => setPkgDescription(e.target.value)}
                placeholder="Describe your dataset..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border bg-background mt-1 resize-none"
              />
            </div>

            <div className="border rounded-lg p-4 space-y-2">
              <h3 className="font-semibold text-sm">
                Select Ready Assets ({selectedAssetIds.length}/{readyAssets.length})
              </h3>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {readyAssets.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No ready assets. Process data in Data Studio first.
                  </p>
                ) : (
                  readyAssets.map((asset) => (
                    <label key={asset.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer">
                      <input type="checkbox" checked={selectedAssetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)} className="rounded" />
                      <span className="text-sm truncate flex-1">{asset.name}</span>
                      {asset.encrypted && <Lock className="w-3 h-3 text-green-500" />}
                      <span className="text-xs text-muted-foreground">{formatBytes(asset.byteSize)}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <button
              onClick={handleCreatePackage}
              disabled={!pkgName || selectedAssetIds.length === 0 || isProcessing}
              className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
              Create Package
            </button>
          </div>
        )}

        {step === "policy" && (
          <div className="space-y-4">
            <div className="p-4 border rounded-lg bg-green-500/5 border-green-500/30">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">Package created with encrypted CIDs</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Raw data never leaves your device. Only encrypted payloads are shared.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium">Pricing Model</label>
              <select
                value={pricingModel}
                onChange={(e) => setPricingModel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
              >
                <option value="free">Free</option>
                <option value="one_time">One-Time Purchase</option>
                <option value="subscription">Subscription</option>
                <option value="per_use">Per Use</option>
                <option value="per_token">Per Token</option>
                <option value="pay_what_you_want">Pay What You Want</option>
              </select>
            </div>

            {pricingModel !== "free" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Price (USD)</label>
                  <input
                    type="number"
                    value={priceAmount}
                    onChange={(e) => setPriceAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">License</label>
                  <select
                    value={license}
                    onChange={(e) => setLicense(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                  >
                    <option value="cc-by-4.0">CC-BY 4.0</option>
                    <option value="cc-by-sa-4.0">CC-BY-SA 4.0</option>
                    <option value="cc-by-nc-4.0">CC-BY-NC 4.0</option>
                    <option value="mit">MIT</option>
                    <option value="apache-2.0">Apache 2.0</option>
                    <option value="proprietary">Proprietary</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={sovereignExit}
                onChange={(e) => setSovereignExit(e.target.checked)}
                id="sovereign-exit"
                className="rounded"
              />
              <label htmlFor="sovereign-exit" className="text-sm">
                Enable BTC/Taproot sovereign exit (future-proof)
              </label>
            </div>

            {sovereignExit && (
              <div>
                <label className="text-sm font-medium">BTC Taproot Address</label>
                <input
                  value={btcAddress}
                  onChange={(e) => setBtcAddress(e.target.value)}
                  placeholder="bc1p..."
                  className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                />
              </div>
            )}

            <button
              onClick={handleCreatePolicy}
              disabled={isProcessing}
              className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              Create Policy
            </button>
          </div>
        )}

        {step === "publish" && (
          <div className="space-y-4">
            <div className="p-4 border rounded-lg bg-green-500/5 border-green-500/30">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">Package + Policy ready</span>
              </div>
            </div>

            <div className="p-4 border rounded-lg space-y-2">
              <h3 className="font-semibold">Publish Bundle Summary</h3>
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{pkgName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span>{pkgVersion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Assets</span>
                  <span>{selectedAssetIds.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pricing</span>
                  <span>{pricingModel === "free" ? "Free" : `$${priceAmount}`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Encryption</span>
                  <span className="text-green-500 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> AES-256-GCM
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Raw data shared</span>
                  <span className="text-green-500 font-medium">Never</span>
                </div>
              </div>
            </div>

            <button
              onClick={handlePublish}
              disabled={isProcessing}
              className="w-full px-4 py-2 rounded-lg bg-green-600 text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-green-700"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Publish to JoyMarketplace
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="p-6 border rounded-lg bg-green-500/5 border-green-500/30 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
              <h2 className="text-xl font-bold">Published Successfully!</h2>
              <p className="text-muted-foreground">
                Your encrypted data package is ready for JoyMarketplace.
                Only encrypted payloads were shared — your raw data stays on your device.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={reset}
                className="flex-1 px-4 py-2 rounded-lg border font-medium text-sm hover:bg-muted"
              >
                Create Another
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Existing bundles */}
      {bundles.length > 0 && (
        <div className="space-y-2 pt-4 border-t">
          <h2 className="text-lg font-semibold">Published Bundles</h2>
          <div className="grid gap-3">
            {bundles.map((bundle: any) => (
              <div key={bundle.id} className="border rounded-lg p-4 flex items-center gap-4">
                <Send className="w-5 h-5 text-green-500" />
                <div className="flex-1">
                  <div className="font-medium">{bundle.listingName}</div>
                  <div className="text-sm text-muted-foreground">
                    {bundle.listingPricingModel ?? "free"} · {bundle.status}
                  </div>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify({
                      manifestCid: bundle.manifestCid,
                      policyCid: bundle.policyCid,
                      status: bundle.status,
                    }, null, 2));
                    toast.success("Bundle CIDs copied to clipboard");
                  }}
                  className="p-2 rounded-lg hover:bg-muted"
                  title="Copy bundle CIDs"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </VaultLockGate>
  );
}
