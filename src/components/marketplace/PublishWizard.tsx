/**
 * PublishWizard — Unified multi-step publishing dialog for all asset types.
 * Used by apps, agents, workflows, datasets, and models to publish to JoyMarketplace.
 */

import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  Check,
  Tag,
  DollarSign,
  FileText,
  Eye,
  Shield,
  X,
} from "lucide-react";
import type {
  PublishableAssetType,
  UnifiedCategory,
  LicenseType,
  UnifiedPublishPayload,
} from "@/types/publish_types";
import type { PricingModel } from "@/types/marketplace_types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES: { value: UnifiedCategory; label: string }[] = [
  { value: "web-app", label: "Web App" },
  { value: "mobile-app", label: "Mobile App" },
  { value: "dashboard", label: "Dashboard" },
  { value: "e-commerce", label: "E-Commerce" },
  { value: "saas", label: "SaaS" },
  { value: "ai-agent", label: "AI Agent" },
  { value: "ai-workflow", label: "AI Workflow" },
  { value: "automation", label: "Automation" },
  { value: "dataset", label: "Dataset" },
  { value: "model", label: "Model" },
  { value: "template", label: "Template" },
  { value: "tool", label: "Tool" },
  { value: "connector", label: "Connector" },
  { value: "other", label: "Other" },
];

const PRICING_MODELS: { value: PricingModel; label: string; desc: string }[] = [
  { value: "free", label: "Free", desc: "Anyone can download at no cost" },
  { value: "one-time", label: "One-Time Purchase", desc: "Single payment to access" },
  { value: "subscription", label: "Subscription", desc: "Recurring monthly payment" },
  { value: "pay-what-you-want", label: "Pay What You Want", desc: "Buyers choose their price" },
];

const LICENSES: { value: LicenseType; label: string }[] = [
  { value: "mit", label: "MIT License" },
  { value: "apache-2.0", label: "Apache 2.0" },
  { value: "gpl-3.0", label: "GPL 3.0" },
  { value: "cc-by-4.0", label: "Creative Commons BY 4.0" },
  { value: "cc-by-sa-4.0", label: "CC BY-SA 4.0" },
  { value: "cc-by-nc-4.0", label: "CC BY-NC 4.0 (Non-Commercial)" },
  { value: "proprietary", label: "Proprietary" },
  { value: "custom", label: "Custom License" },
];

const ASSET_TYPE_LABELS: Record<PublishableAssetType, string> = {
  app: "App",
  agent: "Agent",
  workflow: "Workflow",
  dataset: "Dataset",
  model: "Model",
  template: "Template",
  component: "Component",
  plugin: "Plugin",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PublishWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetType: PublishableAssetType;
  sourceId: string | number;
  defaultName?: string;
  defaultDescription?: string;
  defaultCategory?: UnifiedCategory;
  onPublish: (payload: UnifiedPublishPayload) => void;
  isPublishing?: boolean;
}

// Step indicators
const STEPS = ["Details", "Category & Tags", "Pricing", "License", "Review"] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PublishWizard({
  open,
  onOpenChange,
  assetType,
  sourceId,
  defaultName = "",
  defaultDescription = "",
  defaultCategory,
  onPublish,
  isPublishing = false,
}: PublishWizardProps) {
  const [step, setStep] = useState(0);

  // Step 1: Details
  const [name, setName] = useState(defaultName);
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState(defaultDescription);
  const [version, setVersion] = useState("1.0.0");
  const [changelog, setChangelog] = useState("");

  // Step 2: Category & Tags
  const [category, setCategory] = useState<UnifiedCategory>(defaultCategory ?? "other");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Step 3: Pricing
  const [pricingModel, setPricingModel] = useState<PricingModel>("free");
  const [price, setPrice] = useState<number | undefined>(undefined);

  // Step 4: License
  const [license, setLicense] = useState<LicenseType>("mit");
  const [customLicenseUrl, setCustomLicenseUrl] = useState("");

  // Reset when dialog opens
  React.useEffect(() => {
    if (open) {
      setStep(0);
      setName(defaultName);
      setShortDescription("");
      setDescription(defaultDescription);
      setVersion("1.0.0");
      setChangelog("");
      setCategory(defaultCategory ?? "other");
      setTags([]);
      setTagInput("");
      setPricingModel("free");
      setPrice(undefined);
      setLicense("mit");
      setCustomLicenseUrl("");
    }
  }, [open, defaultName, defaultDescription, defaultCategory]);

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
      setTags((prev) => [...prev, trimmed]);
      setTagInput("");
    }
  }, [tagInput, tags]);

  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const canAdvance = (): boolean => {
    switch (step) {
      case 0:
        return name.trim().length >= 2 && shortDescription.trim().length >= 10;
      case 1:
        return category !== "other" || tags.length > 0;
      case 2:
        return pricingModel === "free" || (price !== undefined && price > 0);
      case 3:
        return license !== "custom" || customLicenseUrl.trim().length > 0;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const handlePublish = () => {
    const payload: UnifiedPublishPayload = {
      assetType,
      sourceId,
      name: name.trim(),
      shortDescription: shortDescription.trim(),
      description: description.trim(),
      category,
      tags,
      pricingModel,
      price: pricingModel !== "free" ? price : undefined,
      currency: "USD",
      license,
      customLicenseUrl: license === "custom" ? customLicenseUrl : undefined,
      version,
      changelog: changelog.trim() || undefined,
    };
    onPublish(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publish {ASSET_TYPE_LABELS[assetType]} to JoyMarketplace</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors",
                  i < step
                    ? "bg-green-500 text-white"
                    : i === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn("w-8 h-0.5 mx-1", i < step ? "bg-green-500" : "bg-muted")} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="space-y-4 py-2">
          {/* Step 1: Details */}
          {step === 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`My Awesome ${ASSET_TYPE_LABELS[assetType]}`}
                  maxLength={80}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shortDesc">Short Description * (10-150 chars)</Label>
                <Input
                  id="shortDesc"
                  value={shortDescription}
                  onChange={(e) => setShortDescription(e.target.value)}
                  placeholder="A brief one-liner about what this does"
                  maxLength={150}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Full Description</Label>
                <Textarea
                  id="desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detailed description, features, usage instructions..."
                  rows={5}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="version">Version</Label>
                  <Input
                    id="version"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="changelog">Changelog</Label>
                  <Input
                    id="changelog"
                    value={changelog}
                    onChange={(e) => setChangelog(e.target.value)}
                    placeholder="What's new in this version"
                  />
                </div>
              </div>
            </>
          )}

          {/* Step 2: Category & Tags */}
          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as UnifiedCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tags (up to 10)</Label>
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="Type a tag and press Enter"
                  />
                  <Button type="button" variant="secondary" size="sm" onClick={addTag} disabled={!tagInput.trim()}>
                    <Tag className="w-4 h-4" />
                  </Button>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1 pl-2 pr-1">
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Step 3: Pricing */}
          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {PRICING_MODELS.map((pm) => (
                  <button
                    key={pm.value}
                    type="button"
                    onClick={() => {
                      setPricingModel(pm.value);
                      if (pm.value === "free") setPrice(undefined);
                    }}
                    className={cn(
                      "rounded-lg border-2 p-4 text-left transition-colors",
                      pricingModel === pm.value
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-muted-foreground/30"
                    )}
                  >
                    <p className="font-medium text-sm">{pm.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{pm.desc}</p>
                  </button>
                ))}
              </div>
              {pricingModel !== "free" && (
                <div className="space-y-2 mt-4">
                  <Label htmlFor="price">
                    <DollarSign className="w-4 h-4 inline-block mr-1" />
                    Price (USD)
                  </Label>
                  <Input
                    id="price"
                    type="number"
                    min={0}
                    step={0.01}
                    value={price ?? ""}
                    onChange={(e) => setPrice(e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="9.99"
                  />
                  <p className="text-xs text-muted-foreground">
                    You receive 97.5% of each sale. JoyMarketplace takes a 2.5% platform fee.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Step 4: License */}
          {step === 3 && (
            <>
              <div className="space-y-2">
                <Label>License</Label>
                <Select value={license} onValueChange={(v) => setLicense(v as LicenseType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LICENSES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {license === "custom" && (
                <div className="space-y-2">
                  <Label htmlFor="customLicense">Custom License URL</Label>
                  <Input
                    id="customLicense"
                    value={customLicenseUrl}
                    onChange={(e) => setCustomLicenseUrl(e.target.value)}
                    placeholder="https://example.com/license"
                  />
                </div>
              )}
              <div className="rounded-lg border bg-muted/50 p-4 mt-2">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">License Summary</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {license === "proprietary"
                    ? "Buyers receive a license to use, but cannot redistribute or modify the source."
                    : license === "custom"
                      ? "Your custom license terms will apply."
                      : `This ${ASSET_TYPE_LABELS[assetType].toLowerCase()} will be available under the ${LICENSES.find((l) => l.value === license)?.label} license.`}
                </p>
              </div>
            </>
          )}

          {/* Step 5: Review */}
          {step === 4 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Eye className="w-4 h-4" />
                Review Your Listing
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Name:</span>
                  <p className="font-medium">{name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Type:</span>
                  <p className="font-medium">{ASSET_TYPE_LABELS[assetType]}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Category:</span>
                  <p className="font-medium">{CATEGORIES.find((c) => c.value === category)?.label}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Version:</span>
                  <p className="font-medium">{version}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Pricing:</span>
                  <p className="font-medium">
                    {pricingModel === "free" ? "Free" : `$${price?.toFixed(2) ?? "0.00"} (${pricingModel})`}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">License:</span>
                  <p className="font-medium">{LICENSES.find((l) => l.value === license)?.label}</p>
                </div>
              </div>
              {shortDescription && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Description:</span>
                  <p className="mt-1">{shortDescription}</p>
                </div>
              )}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div>
            {step > 0 && (
              <Button type="button" variant="ghost" onClick={() => setStep(step - 1)} disabled={isPublishing}>
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPublishing}>
              Cancel
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={() => setStep(step + 1)} disabled={!canAdvance()}>
                Next
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button type="button" onClick={handlePublish} disabled={isPublishing}>
                {isPublishing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Publishing…
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-1" />
                    Publish to JoyMarketplace
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
