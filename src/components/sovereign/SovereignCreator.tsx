/**
 * Sovereign Creator Component
 * Unified local-first creation interface for all builders
 * Supports local encryption, IPFS, Arweave, Filecoin storage
 */

import * as React from "react";
import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Shield,
  Lock,
  Unlock,
  Globe,
  HardDrive,
  Cloud,
  Database,
  Share2,
  DollarSign,
  Tag,
  FileUp,
  Download,
  Loader2,
  Check,
  X,
  AlertTriangle,
  Info,
  Sparkles,
  Eye,
  EyeOff,
  Fingerprint,
  Key,
  Hash,
  Network,
  Coins,
  Zap,
} from "lucide-react";
import {
  useDataVault,
  useStoreData,
  useSyncToNetwork,
  useCreateListing,
  useSovereignDataList,
} from "@/ipc/sovereign_data_client";
import type {
  DataType,
  DataVisibility,
  StorageNetwork,
  SovereignMetadata,
  DataLicense,
  DataPricing,
  LicenseType,
  PricingModel,
} from "@/types/sovereign_data";

// ============================================================================
// Types
// ============================================================================

interface SovereignCreatorProps {
  // What type of data is being created
  dataType: DataType;
  
  // Optional: Pre-filled metadata
  initialMetadata?: Partial<SovereignMetadata>;
  
  // The data to store (can be file, JSON, or raw data)
  data?: File | ArrayBuffer | string | object;
  
  // Callback when creation is complete
  onCreated?: (dataId: string, hashes: Record<string, string>) => void;
  
  // Callback when user cancels
  onCancel?: () => void;
  
  // Custom trigger button (optional)
  trigger?: React.ReactNode;
  
  // Dialog open state (controlled mode)
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  
  // Additional children to render in the form
  children?: React.ReactNode;
}

interface StorageOption {
  network: StorageNetwork;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  cost: string;
  speed: string;
  permanence: string;
  enabled?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_OPTIONS: StorageOption[] = [
  {
    network: "local",
    name: "Local Encrypted",
    description: "Stored only on your device, fully encrypted",
    icon: HardDrive,
    color: "text-green-500",
    cost: "Free",
    speed: "Instant",
    permanence: "Device lifetime",
  },
  {
    network: "ipfs",
    name: "IPFS / Helia",
    description: "Distributed content-addressed storage",
    icon: Globe,
    color: "text-blue-500",
    cost: "Low (pinning fees)",
    speed: "Fast",
    permanence: "While pinned",
  },
  {
    network: "arweave",
    name: "Arweave",
    description: "Permanent decentralized storage",
    icon: Database,
    color: "text-yellow-500",
    cost: "One-time (AR tokens)",
    speed: "Minutes",
    permanence: "Forever",
  },
  {
    network: "filecoin",
    name: "Filecoin",
    description: "Incentivized storage network",
    icon: Cloud,
    color: "text-purple-500",
    cost: "FIL tokens/period",
    speed: "Varies",
    permanence: "Deal duration",
  },
];

const VISIBILITY_OPTIONS: { value: DataVisibility; label: string; icon: React.ReactNode }[] = [
  { value: "private", label: "Private", icon: <Lock className="h-4 w-4" /> },
  { value: "shared", label: "Shared", icon: <Share2 className="h-4 w-4" /> },
  { value: "public", label: "Public", icon: <Globe className="h-4 w-4" /> },
  { value: "marketplace", label: "Marketplace", icon: <DollarSign className="h-4 w-4" /> },
];

const LICENSE_TYPES: { value: LicenseType; label: string; description: string }[] = [
  { value: "sovereign", label: "Full Ownership", description: "Transfer complete ownership" },
  { value: "commercial", label: "Commercial Use", description: "Buyer can use commercially" },
  { value: "personal", label: "Personal Use", description: "Personal use only" },
  { value: "research", label: "Research", description: "Academic/research purposes" },
  { value: "derivative", label: "Derivative Allowed", description: "Can create derivatives" },
  { value: "view-only", label: "View Only", description: "Can view but not copy" },
  { value: "pay-per-use", label: "Pay Per Use", description: "Each use costs" },
  { value: "subscription", label: "Subscription", description: "Time-based access" },
];

const PRICING_MODELS: { value: PricingModel; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "fixed", label: "Fixed Price" },
  { value: "pay-per-use", label: "Pay Per Use" },
  { value: "pay-per-inference", label: "Pay Per Inference" },
  { value: "subscription", label: "Subscription" },
  { value: "auction", label: "Auction" },
  { value: "negotiate", label: "Open to Negotiation" },
];

// ============================================================================
// Component
// ============================================================================

export function SovereignCreator({
  dataType,
  initialMetadata,
  data,
  onCreated,
  onCancel,
  trigger,
  open: controlledOpen,
  onOpenChange,
  children,
}: SovereignCreatorProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  // State
  const [step, setStep] = useState<"storage" | "metadata" | "monetize" | "review">("storage");
  const [selectedStorages, setSelectedStorages] = useState<StorageNetwork[]>(["local"]);
  const [visibility, setVisibility] = useState<DataVisibility>("private");
  const [encrypt, setEncrypt] = useState(true);
  const [metadata, setMetadata] = useState<SovereignMetadata>({
    name: initialMetadata?.name || "",
    description: initialMetadata?.description || "",
    tags: initialMetadata?.tags || [],
    category: initialMetadata?.category || dataType,
    ...initialMetadata,
  });
  const [tagInput, setTagInput] = useState("");
  const [pricing, setPricing] = useState<DataPricing>({
    model: "free",
    currency: "USD",
    acceptedPayments: ["joy-token", "eth", "usdc"],
  });
  const [license, setLicense] = useState<DataLicense>({
    type: "personal",
    permissions: ["read"],
    restrictions: [],
  });
  const [trainingConsent, setTrainingConsent] = useState(
    initialMetadata?.consent?.training?.granted ?? false
  );
  const [outboundConsent, setOutboundConsent] = useState(
    initialMetadata?.consent?.outbound?.granted ?? false
  );
  const [outboundPaymentTx, setOutboundPaymentTx] = useState(
    initialMetadata?.consent?.outbound?.paymentTxHash ?? ""
  );
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [syncProgress, setSyncProgress] = useState<Partial<Record<StorageNetwork, "pending" | "syncing" | "done" | "error">>>({});

  // Queries & Mutations
  const { data: vault } = useDataVault();
  const storeDataMutation = useStoreData();
  const syncToNetworkMutation = useSyncToNetwork();
  const createListingMutation = useCreateListing();

  // Handlers
  const toggleStorage = (network: StorageNetwork) => {
    if (network === "local") return; // Local is always required
    
    setSelectedStorages((prev) =>
      prev.includes(network)
        ? prev.filter((n) => n !== network)
        : [...prev, network]
    );
  };

  const addTag = () => {
    if (tagInput.trim() && !metadata.tags.includes(tagInput.trim())) {
      setMetadata((prev) => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()],
      }));
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setMetadata((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  };

  const handleCreate = useCallback(async () => {
    if (!data) return;

    setIsCreating(true);
    setProgress(10);

    try {
      // Prepare data for storage
      let storeData: ArrayBuffer | string;
      if (data instanceof File) {
        storeData = await data.arrayBuffer();
      } else if (data instanceof ArrayBuffer) {
        storeData = data;
      } else if (typeof data === "object") {
        storeData = JSON.stringify(data);
      } else {
        storeData = data;
      }

      // Update metadata with monetization if applicable
      const finalMetadata: SovereignMetadata = {
        ...metadata,
        ...(visibility === "marketplace" && {
          license,
          pricing,
        }),
        consent: {
          training: dataType === "training-data"
            ? {
                granted: trainingConsent,
                grantedAt: trainingConsent ? new Date().toISOString() : undefined,
                scope: "training",
              }
            : metadata.consent?.training,
          outbound: {
            granted: outboundConsent,
            grantedAt: outboundConsent ? new Date().toISOString() : undefined,
            paymentTxHash: outboundPaymentTx || undefined,
          },
        },
      };

      setProgress(30);

      // Store locally first
      const result = await storeDataMutation.mutateAsync({
        data: storeData,
        dataType,
        metadata: finalMetadata,
        visibility,
        encrypt,
      });

      setProgress(50);
      setSyncProgress({ local: "done" });

      // Sync to additional networks
      const hashes: Record<string, string> = {
        local: result.hashes[0]?.hash || "",
      };

      for (const network of selectedStorages) {
        if (network === "local") continue;

        setSyncProgress((prev) => ({ ...prev, [network]: "syncing" }));

        try {
          const synced = await syncToNetworkMutation.mutateAsync({
            dataId: result.id,
            network,
          });

          const networkHash = synced.hashes.find((h) => h.network === network);
          if (networkHash) {
            hashes[network] = networkHash.hash;
          }

          setSyncProgress((prev) => ({ ...prev, [network]: "done" }));
        } catch {
          setSyncProgress((prev) => ({ ...prev, [network]: "error" }));
        }
      }

      setProgress(80);

      // Create marketplace listing if applicable
      if (visibility === "marketplace") {
        await createListingMutation.mutateAsync({
          dataId: result.id,
          dataHash: result.hashes[0]?.hash || "",
          title: metadata.name,
          description: metadata.description || "",
          category: metadata.category,
          tags: metadata.tags,
          pricing,
          license,
        });
      }

      setProgress(100);

      // Callback with result
      onCreated?.(result.id, hashes);

      // Reset and close
      setTimeout(() => {
        setOpen(false);
        resetForm();
      }, 500);
    } catch (error) {
      console.error("Failed to create sovereign data:", error);
    } finally {
      setIsCreating(false);
    }
  }, [
    data,
    dataType,
    metadata,
    visibility,
    encrypt,
    selectedStorages,
    pricing,
    license,
    storeDataMutation,
    syncToNetworkMutation,
    createListingMutation,
    onCreated,
    setOpen,
  ]);

  const resetForm = () => {
    setStep("storage");
    setSelectedStorages(["local"]);
    setVisibility("private");
    setEncrypt(true);
    setMetadata({
      name: initialMetadata?.name || "",
      description: initialMetadata?.description || "",
      tags: initialMetadata?.tags || [],
      category: initialMetadata?.category || dataType,
    });
    setPricing({
      model: "free",
      currency: "USD",
      acceptedPayments: ["joy-token", "eth", "usdc"],
    });
    setLicense({
      type: "personal",
      permissions: ["read"],
      restrictions: [],
    });
    setTrainingConsent(initialMetadata?.consent?.training?.granted ?? false);
    setOutboundConsent(initialMetadata?.consent?.outbound?.granted ?? false);
    setOutboundPaymentTx(initialMetadata?.consent?.outbound?.paymentTxHash ?? "");
    setProgress(0);
    setSyncProgress({});
  };

  const canProceed = () => {
    switch (step) {
      case "storage":
        return selectedStorages.length > 0;
      case "metadata":
        return metadata.name.trim().length > 0;
      case "monetize":
        return true;
      case "review":
        return !!data;
      default:
        return false;
    }
  };

  const nextStep = () => {
    switch (step) {
      case "storage":
        setStep("metadata");
        break;
      case "metadata":
        setStep(visibility === "marketplace" ? "monetize" : "review");
        break;
      case "monetize":
        setStep("review");
        break;
      case "review":
        handleCreate();
        break;
    }
  };

  const prevStep = () => {
    switch (step) {
      case "metadata":
        setStep("storage");
        break;
      case "monetize":
        setStep("metadata");
        break;
      case "review":
        setStep(visibility === "marketplace" ? "monetize" : "metadata");
        break;
    }
  };

  // ============================================================================
  // Render Functions
  // ============================================================================

  const renderStorageStep = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Shield className="h-4 w-4" />
        <span>Your data is always encrypted locally. Choose where to replicate.</span>
      </div>

      <div className="grid gap-4">
        {STORAGE_OPTIONS.map((option) => {
          const isSelected = selectedStorages.includes(option.network);
          const vaultConfig = vault?.storageConfig.find((c) => c.network === option.network);
          const isEnabled = option.network === "local" || vaultConfig?.enabled;

          return (
            <Card
              key={option.network}
              className={`cursor-pointer transition-all ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "hover:border-muted-foreground/50"
              } ${!isEnabled ? "opacity-50" : ""}`}
              onClick={() => isEnabled && toggleStorage(option.network)}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className={`p-2 rounded-lg bg-muted ${option.color}`}>
                  <option.icon className="h-5 w-5" />
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{option.name}</h4>
                    {option.network === "local" && (
                      <Badge variant="outline" className="text-xs">
                        Required
                      </Badge>
                    )}
                    {!isEnabled && option.network !== "local" && (
                      <Badge variant="secondary" className="text-xs">
                        Not configured
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                  <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Cost: {option.cost}</span>
                    <span>Speed: {option.speed}</span>
                    <span>Duration: {option.permanence}</span>
                  </div>
                </div>

                <Switch
                  checked={isSelected}
                  disabled={option.network === "local" || !isEnabled}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Encrypt Data
            </Label>
            <p className="text-sm text-muted-foreground">
              Encrypt with your sovereign key (recommended)
            </p>
          </div>
          <Switch checked={encrypt} onCheckedChange={setEncrypt} />
        </div>

        <div className="space-y-2">
          <Label>Visibility</Label>
          <div className="grid grid-cols-2 gap-2">
            {VISIBILITY_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={visibility === opt.value ? "default" : "outline"}
                className="justify-start"
                onClick={() => setVisibility(opt.value)}
              >
                {opt.icon}
                <span className="ml-2">{opt.label}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderMetadataStep = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={metadata.name}
          onChange={(e) => setMetadata((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="Enter a descriptive name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={metadata.description || ""}
          onChange={(e) =>
            setMetadata((prev) => ({ ...prev, description: e.target.value }))
          }
          placeholder="Describe what this data contains..."
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="Add tags..."
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
          />
          <Button variant="secondary" onClick={addTag}>
            Add
          </Button>
        </div>
        {metadata.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {metadata.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="cursor-pointer">
                {tag}
                <X
                  className="h-3 w-3 ml-1"
                  onClick={() => removeTag(tag)}
                />
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        <Input
          id="category"
          value={metadata.category}
          onChange={(e) =>
            setMetadata((prev) => ({ ...prev, category: e.target.value }))
          }
          placeholder="e.g., AI Model, Dataset, Code"
        />
      </div>

      {dataType === "training-data" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Training Consent</CardTitle>
            <CardDescription>
              Explicitly allow training use before sharing or listing.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Allow training use</p>
              <p className="text-xs text-muted-foreground">
                Required for exports if the vault policy is enabled.
              </p>
            </div>
            <Switch checked={trainingConsent} onCheckedChange={setTrainingConsent} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outbound Consent</CardTitle>
          <CardDescription>
            Required before data can be shared, synced, or listed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Allow outbound use</p>
              <p className="text-xs text-muted-foreground">
                Blocks exports unless explicitly approved.
              </p>
            </div>
            <Switch checked={outboundConsent} onCheckedChange={setOutboundConsent} />
          </div>
          <div className="space-y-2">
            <Label>Payment Tx Hash (optional)</Label>
            <Input
              value={outboundPaymentTx}
              onChange={(e) => setOutboundPaymentTx(e.target.value)}
              placeholder="0x..."
            />
          </div>
        </CardContent>
      </Card>

      {children}
    </div>
  );

  const renderMonetizeStep = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Tag className="h-5 w-5" />
            Pricing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Pricing Model</Label>
            <Select
              value={pricing.model}
              onValueChange={(value: PricingModel) =>
                setPricing((prev) => ({ ...prev, model: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICING_MODELS.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {pricing.model !== "free" && pricing.model !== "negotiate" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Price</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={pricing.price || ""}
                    onChange={(e) =>
                      setPricing((prev) => ({
                        ...prev,
                        price: parseFloat(e.target.value) || 0,
                      }))
                    }
                    placeholder="0.00"
                  />
                  <Select
                    value={pricing.currency}
                    onValueChange={(value) =>
                      setPricing((prev) => ({ ...prev, currency: value }))
                    }
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="ETH">ETH</SelectItem>
                      <SelectItem value="JOY">JOY</SelectItem>
                      <SelectItem value="USDC">USDC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {pricing.model === "subscription" && (
                <div className="space-y-2">
                  <Label>Period</Label>
                  <Select
                    value={pricing.subscriptionPeriod || "monthly"}
                    onValueChange={(value) =>
                      setPricing((prev) => ({
                        ...prev,
                        subscriptionPeriod: value as any,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {(pricing.model === "fixed" || pricing.model === "subscription") && (
            <div className="space-y-2">
              <Label>Royalty on Resale (%)</Label>
              <Input
                type="number"
                min="0"
                max="50"
                value={pricing.royaltyPercent || ""}
                onChange={(e) =>
                  setPricing((prev) => ({
                    ...prev,
                    royaltyPercent: parseFloat(e.target.value) || 0,
                  }))
                }
                placeholder="e.g., 10"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5" />
            License
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>License Type</Label>
            <Select
              value={license.type}
              onValueChange={(value: LicenseType) =>
                setLicense((prev) => ({ ...prev, type: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LICENSE_TYPES.map((lt) => (
                  <SelectItem key={lt.value} value={lt.value}>
                    <div>
                      <div>{lt.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {lt.description}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderReviewStep = () => (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Data Type:</span>
              <span className="ml-2 font-medium">{dataType}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Visibility:</span>
              <span className="ml-2 font-medium capitalize">{visibility}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Encrypted:</span>
              <span className="ml-2 font-medium">{encrypt ? "Yes" : "No"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Networks:</span>
              <span className="ml-2 font-medium">
                {selectedStorages.join(", ")}
              </span>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="font-medium mb-2">Metadata</h4>
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span>
                <span className="ml-2">{metadata.name}</span>
              </div>
              {metadata.description && (
                <div>
                  <span className="text-muted-foreground">Description:</span>
                  <span className="ml-2">{metadata.description}</span>
                </div>
              )}
              {metadata.tags.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Tags:</span>
                  <div className="flex gap-1">
                    {metadata.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {visibility === "marketplace" && (
            <>
              <Separator />
              <div>
                <h4 className="font-medium mb-2">Monetization</h4>
                <div className="space-y-1 text-sm">
                  <div>
                    <span className="text-muted-foreground">Pricing:</span>
                    <span className="ml-2">
                      {pricing.model === "free"
                        ? "Free"
                        : `${pricing.price} ${pricing.currency} (${pricing.model})`}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">License:</span>
                    <span className="ml-2 capitalize">{license.type}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {isCreating && (
        <Card>
          <CardContent className="py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Creating sovereign data...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
              
              <div className="flex flex-wrap gap-2 mt-4">
                {Object.entries(syncProgress).map(([network, status]) => (
                  <Badge
                    key={network}
                    variant={
                      status === "done"
                        ? "default"
                        : status === "error"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {status === "syncing" && (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    )}
                    {status === "done" && <Check className="h-3 w-3 mr-1" />}
                    {status === "error" && <X className="h-3 w-3 mr-1" />}
                    {network}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5" />
            Create Sovereign Data
          </DialogTitle>
          <DialogDescription>
            Store your data locally with optional decentralized replication.
            You own your data - encrypted with your keys.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-2 py-2">
          {["storage", "metadata", ...(visibility === "marketplace" ? ["monetize"] : []), "review"].map(
            (s, i) => (
              <React.Fragment key={s}>
                {i > 0 && <div className="flex-1 h-px bg-muted" />}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                    step === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </div>
              </React.Fragment>
            )
          )}
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="py-4">
            {step === "storage" && renderStorageStep()}
            {step === "metadata" && renderMetadataStep()}
            {step === "monetize" && renderMonetizeStep()}
            {step === "review" && renderReviewStep()}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (step === "storage") {
                onCancel?.();
                setOpen(false);
              } else {
                prevStep();
              }
            }}
            disabled={isCreating}
          >
            {step === "storage" ? "Cancel" : "Back"}
          </Button>
          <Button
            onClick={nextStep}
            disabled={!canProceed() || isCreating}
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : step === "review" ? (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Create
              </>
            ) : (
              "Next"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Quick Actions Hook
// ============================================================================

export function useSovereignActions() {
  const storeData = useStoreData();
  const syncToNetwork = useSyncToNetwork();

  const quickStore = useCallback(
    async (
      data: string | object | ArrayBuffer,
      dataType: DataType,
      name: string,
      options?: {
        description?: string;
        tags?: string[];
        visibility?: DataVisibility;
        networks?: StorageNetwork[];
      }
    ) => {
      const preparedData = typeof data === "object" && !(data instanceof ArrayBuffer)
        ? JSON.stringify(data)
        : data;

      const result = await storeData.mutateAsync({
        data: preparedData,
        dataType,
        metadata: {
          name,
          description: options?.description || "",
          tags: options?.tags || [],
          category: dataType,
        },
        visibility: options?.visibility || "private",
        encrypt: true,
      });

      // Sync to additional networks
      if (options?.networks) {
        for (const network of options.networks) {
          if (network !== "local") {
            try {
              await syncToNetwork.mutateAsync({
                dataId: result.id,
                network,
              });
            } catch (e) {
              console.error(`Failed to sync to ${network}:`, e);
            }
          }
        }
      }

      return result;
    },
    [storeData, syncToNetwork]
  );

  return {
    quickStore,
    isStoring: storeData.isPending || syncToNetwork.isPending,
  };
}

export default SovereignCreator;
