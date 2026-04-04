import { useState } from "react";
import {
  Download,
  CheckCircle2,
  Folder,
  FileText,
  Sparkles,
  Package,
  Shield,
  Send,
  ArrowRight,
  Loader2,
  Lock,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HuggingFaceExplorer } from "@/components/HuggingFaceExplorer";
import { useExport } from "@/hooks/use-export";
import {
  useTransformTemplates,
  useTransformExportDataset,
  usePrepareTraining,
  useDatasetTransformStats,
} from "@/hooks/useDataStudioExtended";
import {
  useVaultAssets,
  usePackages,
  useCreatePackage,
  useCreatePolicy,
  useCreatePublishBundle,
} from "@/hooks/useLocalVault";
import { formatBytes } from "@/lib/vault_utils";

interface ExportTabProps {
  datasetId: string | null;
}

export default function ExportTab({ datasetId }: ExportTabProps) {
  const [activeSection, setActiveSection] = useState<"export" | "huggingface" | "marketplace">("export");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          variant={activeSection === "export" ? "default" : "outline"}
          onClick={() => setActiveSection("export")}
          size="sm"
        >
          <Download className="h-4 w-4 mr-1.5" />
          Export & Training
        </Button>
        <Button
          variant={activeSection === "huggingface" ? "default" : "outline"}
          onClick={() => setActiveSection("huggingface")}
          size="sm"
        >
          <Sparkles className="h-4 w-4 mr-1.5" />
          HuggingFace Hub
        </Button>
        <Button
          variant={activeSection === "marketplace" ? "default" : "outline"}
          onClick={() => setActiveSection("marketplace")}
          size="sm"
        >
          <Package className="h-4 w-4 mr-1.5" />
          Marketplace Publishing
        </Button>
      </div>

      {activeSection === "export" && <ExportSection datasetId={datasetId} />}
      {activeSection === "huggingface" && (
        <Card>
          <CardHeader>
            <CardTitle>HuggingFace Hub</CardTitle>
            <CardDescription>Browse and download models and datasets from HuggingFace Hub</CardDescription>
          </CardHeader>
          <CardContent>
            <HuggingFaceExplorer />
          </CardContent>
        </Card>
      )}
      {activeSection === "marketplace" && <MarketplaceSection />}
    </div>
  );
}

function ExportSection({ datasetId }: { datasetId: string | null }) {
  const [exportFormat, setExportFormat] = useState("huggingface");
  const [outputDir, setOutputDir] = useState("");
  const [framework, setFramework] = useState("huggingface");

  const { data: templates } = useTransformTemplates();
  const { data: stats } = useDatasetTransformStats(datasetId || "");
  const exportDataset = useTransformExportDataset();
  const prepareTraining = usePrepareTraining();
  const { exportToDocument, hasLibreOffice, isExporting } = useExport();

  const handleExport = () => {
    if (!datasetId || !outputDir) return;
    exportDataset.mutate({
      datasetId,
      config: {
        format: exportFormat as any,
        outputDir,
        splitRatios: { train: 0.8, val: 0.1, test: 0.1 },
        shuffleSeed: 42,
      },
    });
  };

  const handlePrepareTraining = () => {
    if (!datasetId || !outputDir) return;
    prepareTraining.mutate({
      datasetId,
      outputDir,
      framework: framework as any,
    });
  };

  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Dataset
            </CardTitle>
            <CardDescription>Export to various training-ready formats</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!datasetId ? (
              <p className="text-muted-foreground">Select a dataset first (Datasets tab)</p>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Export Format</label>
                  <Select value={exportFormat} onValueChange={setExportFormat}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="jsonl">JSONL (Generic)</SelectItem>
                      <SelectItem value="csv">CSV</SelectItem>
                      <SelectItem value="huggingface">HuggingFace Datasets</SelectItem>
                      <SelectItem value="alpaca">Alpaca Format</SelectItem>
                      <SelectItem value="sharegpt">ShareGPT Format</SelectItem>
                      <SelectItem value="openai">OpenAI Fine-tune Format</SelectItem>
                      <SelectItem value="llama">LLaMA Format</SelectItem>
                      <SelectItem value="text-plain">Plain Text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Output Directory</label>
                  <Input
                    value={outputDir}
                    onChange={(e) => setOutputDir(e.target.value)}
                    placeholder="C:/Users/data/exports/my-dataset"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 p-3 bg-muted rounded-md">
                  <div className="text-center">
                    <p className="text-xl font-bold">80%</p>
                    <p className="text-xs text-muted-foreground">Train</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold">10%</p>
                    <p className="text-xs text-muted-foreground">Validation</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold">10%</p>
                    <p className="text-xs text-muted-foreground">Test</p>
                  </div>
                </div>

                <Button onClick={handleExport} disabled={!outputDir || exportDataset.isPending}>
                  <Download className="h-4 w-4 mr-2" />
                  Export Dataset
                </Button>

                {exportDataset.data && exportDataset.data.result && (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-sm">
                      Exported {exportDataset.data.result.totalItems} items to{" "}
                      {exportDataset.data.result.files?.length || 0} files
                    </span>
                  </div>
                )}

                {hasLibreOffice && (
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!datasetId || isExporting}
                      onClick={() => {
                        if (!datasetId) return;
                        const s = stats?.stats;
                        const sections = [
                          { type: "heading" as const, level: 1, content: "Dataset Report" },
                          { type: "paragraph" as const, content: `Dataset ID: ${datasetId}` },
                          { type: "heading" as const, level: 2, content: "Statistics" },
                          { type: "paragraph" as const, content: `Total Items: ${s?.itemCount?.toLocaleString() ?? "N/A"}` },
                          { type: "paragraph" as const, content: `Total Tokens: ${s?.totalTokens?.toLocaleString() ?? "N/A"}` },
                          { type: "paragraph" as const, content: `Generated: ${new Date().toLocaleString()}` },
                        ];
                        exportToDocument.mutate({
                          name: `dataset-report-${datasetId}`,
                          sections,
                          format: "pdf",
                          title: "Dataset Report",
                        });
                      }}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Export Report (PDF)
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Folder className="h-5 w-5" />
              Prepare for Training
            </CardTitle>
            <CardDescription>Create complete folder structure for ML frameworks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Framework</label>
              <Select value={framework} onValueChange={setFramework}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="huggingface">HuggingFace Transformers</SelectItem>
                  <SelectItem value="pytorch">PyTorch</SelectItem>
                  <SelectItem value="tensorflow">TensorFlow</SelectItem>
                  <SelectItem value="llama">LLaMA / llama.cpp</SelectItem>
                  <SelectItem value="lora">LoRA Fine-tuning</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handlePrepareTraining}
              disabled={!datasetId || !outputDir || prepareTraining.isPending}
              variant="outline"
            >
              <Folder className="h-4 w-4 mr-2" />
              Create Training Structure
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dataset Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.stats ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Items</span>
                  <span className="font-medium">{stats.stats.itemCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total Tokens</span>
                  <span className="font-medium">{stats.stats.totalTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Avg Tokens/Item</span>
                  <span className="font-medium">{Math.round(stats.stats.avgTokensPerItem)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Min Tokens</span>
                  <span className="font-medium">{stats.stats.minTokens}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Max Tokens</span>
                  <span className="font-medium">{stats.stats.maxTokens}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a dataset to view stats</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Folder Templates</CardTitle>
          </CardHeader>
          <CardContent>
            {templates?.templates ? (
              <div className="space-y-2">
                {templates.templates.map((t) => (
                  <div key={t.id} className="p-2 border rounded">
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading templates...</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MarketplaceSection() {
  const { data: assetsResult } = useVaultAssets({ status: "ready", limit: 200 });
  const createPackage = useCreatePackage();
  const createPolicy = useCreatePolicy();
  const createBundle = useCreatePublishBundle();

  const readyAssets = assetsResult?.assets ?? [];

  const [step, setStep] = useState<"select" | "policy" | "publish" | "done">("select");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [pkgName, setPkgName] = useState("");
  const [pkgVersion, setPkgVersion] = useState("1.0.0");
  const [pkgDescription, setPkgDescription] = useState("");
  const [publisherWallet, setPublisherWallet] = useState("");
  const [pricingModel, setPricingModel] = useState("free");
  const [priceAmount, setPriceAmount] = useState(0);
  const [license, setLicense] = useState("cc-by-4.0");
  const [createdPackageId, setCreatedPackageId] = useState<string | null>(null);
  const [createdPolicyId, setCreatedPolicyId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const toggleAsset = (id: string) => {
    setSelectedAssetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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
      await createBundle.mutateAsync({
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
  };

  return (
    <div className="space-y-4">
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
                  : ["select", "policy", "publish", "done"].indexOf(step) >
                      ["select", "policy", "publish", "done"].indexOf(s.key)
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

      <div className="max-w-5xl">
        {step === "select" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Package Name</label>
              <Input value={pkgName} onChange={(e) => setPkgName(e.target.value)} placeholder="My Curated Dataset" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Version</label>
                <Input value={pkgVersion} onChange={(e) => setPkgVersion(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Publisher Wallet</label>
                <Input value={publisherWallet} onChange={(e) => setPublisherWallet(e.target.value)} placeholder="0x..." className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input value={pkgDescription} onChange={(e) => setPkgDescription(e.target.value)} placeholder="Describe your dataset..." className="mt-1" />
            </div>

            <div className="border rounded-lg p-4 space-y-2">
              <h3 className="font-semibold text-sm">
                Select Ready Assets ({selectedAssetIds.length}/{readyAssets.length})
              </h3>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {readyAssets.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No ready assets. Process data in the Refine tab first.</p>
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

            <Button onClick={handleCreatePackage} disabled={!pkgName || selectedAssetIds.length === 0 || isProcessing} className="w-full">
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Package className="w-4 h-4 mr-2" />}
              Create Package
            </Button>
          </div>
        )}

        {step === "policy" && (
          <div className="space-y-4">
            <div className="p-4 border rounded-lg bg-green-500/5 border-green-500/30">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">Package created with encrypted CIDs</span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Pricing Model</label>
              <Select value={pricingModel} onValueChange={setPricingModel}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="one_time">One-Time Purchase</SelectItem>
                  <SelectItem value="subscription">Subscription</SelectItem>
                  <SelectItem value="per_use">Per Use</SelectItem>
                  <SelectItem value="pay_what_you_want">Pay What You Want</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {pricingModel !== "free" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Price (USD)</label>
                  <Input type="number" value={priceAmount} onChange={(e) => setPriceAmount(Number(e.target.value))} className="mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium">License</label>
                  <Select value={license} onValueChange={setLicense}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cc-by-4.0">CC-BY 4.0</SelectItem>
                      <SelectItem value="cc-by-sa-4.0">CC-BY-SA 4.0</SelectItem>
                      <SelectItem value="cc-by-nc-4.0">CC-BY-NC 4.0</SelectItem>
                      <SelectItem value="mit">MIT</SelectItem>
                      <SelectItem value="apache-2.0">Apache 2.0</SelectItem>
                      <SelectItem value="proprietary">Proprietary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <Button onClick={handleCreatePolicy} disabled={isProcessing} className="w-full">
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
              Create Policy
            </Button>
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
              </div>
            </div>
            <Button onClick={handlePublish} disabled={isProcessing} className="w-full bg-green-600 hover:bg-green-700 text-white">
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Publish to JoyMarketplace
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="p-6 border rounded-lg bg-green-500/5 border-green-500/30 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
              <h2 className="text-xl font-bold">Published Successfully!</h2>
              <p className="text-muted-foreground">
                Your encrypted data package is ready for JoyMarketplace. Raw data stays on your device.
              </p>
            </div>
            <Button variant="outline" onClick={reset} className="w-full">
              Publish Another
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
