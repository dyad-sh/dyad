/**
 * /joy/publish — Universal Asset Wizard.
 *
 * Studios deep-link here with `?type=image&assetId=…&studio=image_studio&contentCid=…&name=…`.
 *
 * Steps:
 *   1. Pick store (or create one)
 *   2. Upload file (-> joybridge:pin-to-ipfs) — skipped if `contentCid` is in URL
 *   3. Metadata (name, description, license)
 *   4. Price + royalty + tier
 *   5. Confirm + publish via joybridge:publish-asset
 *
 * Backed by:
 *   - joybridge:list-my-stores
 *   - joybridge:pin-to-ipfs
 *   - joybridge:publish-asset
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch, useNavigate, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { IpcClient } from "@/ipc/ipc_client";
import { Sparkles, Upload, ChevronLeft, ChevronRight, Check } from "lucide-react";
import type {
  Asset,
  PinResult,
  PublishAssetInput,
  Result,
  Store,
} from "@/lib/joybridge_client";

const LICENSES = [
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC0-1.0",
  "Commercial-Use",
  "Personal-Use-Only",
] as const;

const ASSET_TYPES = ["image", "video", "agent", "model", "document"] as const;

type Step = 0 | 1 | 2 | 3 | 4;

export default function JoyPublishPage() {
  const search = useSearch({ from: "/joy/publish" });
  const navigate = useNavigate();

  const [stores, setStores] = useState<Store[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [step, setStep] = useState<Step>(0);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<Asset | null>(null);

  // Form state — pre-filled from URL search params where possible.
  const [storeId, setStoreId] = useState<string>("");
  const [assetType, setAssetType] = useState<string>(
    (search.type as string) ?? "image",
  );
  const [name, setName] = useState<string>((search.name as string) ?? "");
  const [description, setDescription] = useState("");
  const [license, setLicense] = useState<string>("CC-BY-4.0");
  const [priceDollars, setPriceDollars] = useState<string>("0");
  const [royaltyPct, setRoyaltyPct] = useState<string>("5");
  const [tier, setTier] = useState<string>("0");
  const [contentCid, setContentCid] = useState<string>(
    (search.contentCid as string) ?? "",
  );

  // File picker state
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [filename, setFilename] = useState<string>("");

  useEffect(() => {
    void (async () => {
      try {
        const ipc = IpcClient.getInstance();
        const res = (await ipc.invoke("joybridge:list-my-stores")) as Result<
          Store[]
        >;
        if (res?.ok) {
          const list = res.data ?? [];
          setStores(list);
          if (list.length > 0 && !storeId) setStoreId(list[0].id);
        }
      } finally {
        setStoresLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const studioBadge = useMemo(() => {
    const s = search.studio as string | undefined;
    return s ? s.replace(/_/g, " ") : null;
  }, [search.studio]);

  async function handlePick(): Promise<void> {
    fileInput.current?.click();
  }

  async function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setUploading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const ipc = IpcClient.getInstance();
      const res = (await ipc.invoke("joybridge:pin-to-ipfs", {
        data: buf,
        filename: file.name,
        contentType: file.type,
      })) as Result<PinResult>;
      if (res?.ok && res.data?.cid) {
        setContentCid(res.data.cid);
      } else {
        setError(res?.ok ? "Pin returned no CID" : res?.error ?? "Pin failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function publish(): Promise<void> {
    if (!storeId) {
      setError("Pick a store first.");
      return;
    }
    if (!contentCid) {
      setError("Upload (and pin) the asset first.");
      return;
    }
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const ipc = IpcClient.getInstance();
      const input: PublishAssetInput = {
        storeId,
        assetType,
        name: name.trim(),
        description: description.trim() || undefined,
        contentCid,
        priceUsdc: Math.round(Number(priceDollars) * 1_000_000),
        royaltyBps: Math.round(Number(royaltyPct) * 100),
        license,
        tier: Number(tier) || 0,
      };
      const res = (await ipc.invoke(
        "joybridge:publish-asset",
        input,
      )) as Result<Asset>;
      if (res?.ok) {
        setPublished(res.data ?? null);
        setStep(4);
      } else {
        setError(res?.error ?? "Publish failed");
      }
    } finally {
      setPublishing(false);
    }
  }

  const canNext = (() => {
    switch (step) {
      case 0:
        return Boolean(storeId);
      case 1:
        return Boolean(contentCid);
      case 2:
        return Boolean(name.trim());
      case 3:
        return true;
      default:
        return false;
    }
  })();

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-4">
      <header>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Sparkles className="h-8 w-8 text-purple-500" />
          Publish to Joy Marketplace
        </h1>
        <p className="text-muted-foreground">
          Walk through the wizard to mint, list, and pin your asset.
          {studioBadge && (
            <Badge variant="outline" className="ml-2">
              from {studioBadge}
            </Badge>
          )}
        </p>
      </header>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {["Store", "Upload", "Metadata", "Price", "Done"].map((label, idx) => (
          <div
            key={label}
            className={`flex items-center gap-1 ${
              idx === step
                ? "text-foreground font-medium"
                : idx < step
                ? "text-emerald-600"
                : ""
            }`}
          >
            {idx < step ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="h-5 w-5 rounded-full border flex items-center justify-center text-xs">
                {idx + 1}
              </span>
            )}
            {label}
            {idx < 4 && <ChevronRight className="h-3 w-3" />}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {step === 0 && "Pick a store"}
            {step === 1 && "Upload your asset"}
            {step === 2 && "Metadata"}
            {step === 3 && "Price + royalty"}
            {step === 4 && "Published!"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <>
              {storesLoading ? (
                <p className="text-muted-foreground">Loading stores…</p>
              ) : stores.length === 0 ? (
                <div className="space-y-2">
                  <p>You don't have any stores yet.</p>
                  <Link to="/joy/my-stores">
                    <Button>Create a store first</Button>
                  </Link>
                </div>
              ) : (
                <div>
                  <Label>Choose a store</Label>
                  <Select value={storeId} onValueChange={setStoreId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick…" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} (/{s.slug})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Pin your asset to IPFS via the marketplace. The CID becomes your
                asset's content reference.
              </p>
              {contentCid ? (
                <div className="space-y-2">
                  <Badge variant="outline" className="font-mono break-all">
                    {contentCid}
                  </Badge>
                  {filename && (
                    <p className="text-xs text-muted-foreground">{filename}</p>
                  )}
                  <Button variant="outline" onClick={handlePick} disabled={uploading}>
                    Replace file
                  </Button>
                </div>
              ) : (
                <Button onClick={handlePick} disabled={uploading}>
                  <Upload className="h-4 w-4 mr-2" />
                  {uploading ? "Pinning…" : "Choose file"}
                </Button>
              )}
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div>
                <Label>Asset type</Label>
                <Select value={assetType} onValueChange={setAssetType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="A descriptive name"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </div>
              <div>
                <Label>License</Label>
                <Select value={license} onValueChange={setLicense}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LICENSES.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Price (USDC)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  0 = free
                </p>
              </div>
              <div>
                <Label>Royalty %</Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={royaltyPct}
                  onChange={(e) => setRoyaltyPct(e.target.value)}
                />
              </div>
              <div>
                <Label>Tier</Label>
                <Input
                  type="number"
                  min={0}
                  max={255}
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  0 = standard
                </p>
              </div>
            </div>
          )}

          {step === 4 && published && (
            <div className="space-y-3">
              <p className="text-emerald-600 font-medium">
                Asset published successfully.
              </p>
              <Card>
                <CardContent className="p-4 space-y-1 text-sm">
                  <p>
                    <strong>Name:</strong> {published.name}
                  </p>
                  <p>
                    <strong>Type:</strong> {published.assetType}
                  </p>
                  {published.tokenId && (
                    <p className="font-mono break-all">
                      <strong>Token:</strong> {published.tokenId}
                    </p>
                  )}
                </CardContent>
              </Card>
              <div className="flex gap-2">
                <Link to="/joy/my-assets">
                  <Button>View My Assets</Button>
                </Link>
                <Link to="/joy/marketplace">
                  <Button variant="outline">Browse Marketplace</Button>
                </Link>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </CardContent>
      </Card>

      {step < 4 && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            disabled={step === 0 || publishing}
            onClick={() => setStep(Math.max(0, step - 1) as Step)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          {step < 3 ? (
            <Button
              disabled={!canNext}
              onClick={() => setStep(Math.min(4, step + 1) as Step)}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={publish}
              disabled={publishing || !canNext}
            >
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          )}
        </div>
      )}

      {!navigate ? null : null /* keep navigate referenced */}
    </div>
  );
}
