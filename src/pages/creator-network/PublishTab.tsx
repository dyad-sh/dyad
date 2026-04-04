import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FederationClient } from "@/ipc/federation_client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Package,
  Puzzle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import type { NFTListing } from "@/types/nft_types";
import type { P2PPricing, P2PLicense, ModelChunkListing } from "@/types/federation_types";

export default function PublishTab() {
  const queryClient = useQueryClient();

  // Asset listing form
  const [assetForm, setAssetForm] = useState({
    title: "",
    description: "",
    category: "model",
    assetId: "",
    price: 0,
    currency: "USDC",
    licenseType: "license" as "ownership" | "license" | "rental" | "subscription",
    canResell: false,
    canModify: false,
    canCommercialUse: true,
    privateKey: "",
  });

  // Model chunk listing form
  const [chunkListingForm, setChunkListingForm] = useState({
    title: "",
    modelId: "",
    modelHash: "",
    chunkCids: "",
    chunkCount: 0,
    bytesTotal: 0,
    tags: "",
    price: 0,
    currency: "USDC",
    licenseType: "training" as "training" | "inference" | "research" | "non-commercial" | "custom",
    privateKey: "",
  });

  const { data: identity } = useQuery({
    queryKey: ["federation-identity"],
    queryFn: () => FederationClient.getIdentity(),
  });

  const { data: listings = [] } = useQuery({
    queryKey: ["federation-listings"],
    queryFn: () => FederationClient.getListings(),
  });

  const { data: chunkListings = [] } = useQuery<ModelChunkListing[]>({
    queryKey: ["federation-model-chunk-listings"],
    queryFn: () => FederationClient.listModelChunkListings(),
  });

  // My listings = listings where seller DID matches my identity
  const myListings = listings.filter((l) => l.seller.did === identity?.did);
  const myChunkListings = chunkListings.filter((l) => l.seller.did === identity?.did);

  const createAssetListingMutation = useMutation({
    mutationFn: () => {
      if (!assetForm.title || !assetForm.privateKey) {
        throw new Error("Title and private key are required");
      }
      const assetId = assetForm.assetId || `asset-${Date.now()}`;
      const nftListing: NFTListing = {
        id: `nft-${Date.now()}`,
        chunk_id: `chunk-${Date.now()}`,
        asset_id: assetId,
        network: "polygon",
        standard: "ERC-721",
        metadata: {
          name: assetForm.title,
          description: assetForm.description,
          image: "",
          attributes: [{ trait_type: "category", value: assetForm.category }],
          properties: {
            category: "model" as const,
            license: "commercial-use" as const,
            creator: identity?.did || "",
            created_at: new Date().toISOString(),
            version: "1.0.0",
            files: [],
          },
        },
        pricing: {
          type: "fixed" as const,
          price: assetForm.price,
          currency: assetForm.currency,
        },
        status: "listed",
        views: 0,
        favorites: 0,
        offers: [],
        creator: identity?.did || "",
        owner: identity?.did || "",
        royalty_percentage: 5,
        created_at: new Date().toISOString(),
      };
      const pricing: P2PPricing = {
        type: "fixed",
        base_price: assetForm.price,
        accepted_currencies: [{ symbol: assetForm.currency, network: "polygon" }],
        preferred_currency: { symbol: assetForm.currency, network: "polygon" },
        escrow_required: true,
      };
      const license: P2PLicense = {
        type: assetForm.licenseType,
        can_resell: assetForm.canResell,
        can_modify: assetForm.canModify,
        can_commercial_use: assetForm.canCommercialUse,
        can_distribute: false,
        duration: "perpetual",
      };
      return FederationClient.createListing({
        nftListing,
        pricing,
        license,
        privateKey: assetForm.privateKey,
      });
    },
    onSuccess: () => {
      toast.success("Asset listing created!");
      queryClient.invalidateQueries({ queryKey: ["federation-listings"] });
      setAssetForm({
        title: "",
        description: "",
        category: "model",
        assetId: "",
        price: 0,
        currency: "USDC",
        licenseType: "license",
        canResell: false,
        canModify: false,
        canCommercialUse: true,
        privateKey: "",
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create listing");
    },
  });

  const createChunkListingMutation = useMutation({
    mutationFn: () => {
      const chunkCids = chunkListingForm.chunkCids
        .split(",")
        .map((cid) => cid.trim())
        .filter(Boolean);
      if (!chunkListingForm.title || !chunkListingForm.modelId || chunkCids.length === 0) {
        throw new Error("Title, model ID, and chunk CIDs are required");
      }
      if (!chunkListingForm.privateKey) {
        throw new Error("Private key is required to sign the listing");
      }

      return FederationClient.createModelChunkListing({
        modelId: chunkListingForm.modelId,
        modelHash: chunkListingForm.modelHash || undefined,
        title: chunkListingForm.title,
        description: undefined,
        tags: chunkListingForm.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        chunkCids,
        chunkCount: chunkListingForm.chunkCount || chunkCids.length,
        bytesTotal: chunkListingForm.bytesTotal || undefined,
        pricing: {
          type: "fixed",
          base_price: chunkListingForm.price,
          accepted_currencies: [
            { symbol: chunkListingForm.currency, network: "polygon" },
          ],
          preferred_currency: {
            symbol: chunkListingForm.currency,
            network: "polygon",
          },
          escrow_required: true,
        },
        license: {
          type: chunkListingForm.licenseType,
        },
        privateKey: chunkListingForm.privateKey,
      });
    },
    onSuccess: () => {
      toast.success("Model chunk listing created");
      queryClient.invalidateQueries({ queryKey: ["federation-model-chunk-listings"] });
      setChunkListingForm({
        title: "",
        modelId: "",
        modelHash: "",
        chunkCids: "",
        chunkCount: 0,
        bytesTotal: 0,
        tags: "",
        price: 0,
        currency: "USDC",
        licenseType: "training",
        privateKey: "",
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create listing");
    },
  });

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* My Listings Summary */}
        {(myListings.length > 0 || myChunkListings.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>My Published Listings</CardTitle>
              <CardDescription>
                {myListings.length} asset listing{myListings.length !== 1 ? "s" : ""} and{" "}
                {myChunkListings.length} model chunk listing{myChunkListings.length !== 1 ? "s" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {myListings.map((listing) => (
                  <div
                    key={listing.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{listing.asset_id}</p>
                        <p className="text-xs text-muted-foreground">
                          {listing.pricing.base_price} {listing.pricing.preferred_currency.symbol}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={listing.status === "active" ? "default" : "secondary"}
                    >
                      {listing.status}
                    </Badge>
                  </div>
                ))}
                {myChunkListings.map((listing) => (
                  <div
                    key={listing.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <Puzzle className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{listing.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {listing.chunk_count} chunks •{" "}
                          {listing.pricing.base_price} {listing.pricing.preferred_currency.symbol}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={listing.status === "active" ? "default" : "secondary"}
                    >
                      {listing.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Create Asset Listing */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-cyan-500" />
              Create Asset Listing
            </CardTitle>
            <CardDescription>
              Publish a digital asset to the creator network marketplace
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Title *</Label>
                <Input
                  value={assetForm.title}
                  onChange={(e) =>
                    setAssetForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="My AI Model Package"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={assetForm.category}
                  onValueChange={(value) =>
                    setAssetForm((prev) => ({ ...prev, category: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="model">AI Model</SelectItem>
                    <SelectItem value="dataset">Dataset</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="workflow">Workflow</SelectItem>
                    <SelectItem value="plugin">Plugin</SelectItem>
                    <SelectItem value="template">Template</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={assetForm.description}
                  onChange={(e) =>
                    setAssetForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Describe your asset..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Asset ID (optional)</Label>
                <Input
                  value={assetForm.assetId}
                  onChange={(e) =>
                    setAssetForm((prev) => ({ ...prev, assetId: e.target.value }))
                  }
                  placeholder="Auto-generated if blank"
                />
              </div>
              <div className="space-y-2">
                <Label>Price</Label>
                <Input
                  type="number"
                  value={assetForm.price}
                  onChange={(e) =>
                    setAssetForm((prev) => ({ ...prev, price: Number(e.target.value) }))
                  }
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select
                  value={assetForm.currency}
                  onValueChange={(value) =>
                    setAssetForm((prev) => ({ ...prev, currency: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USDC">USDC</SelectItem>
                    <SelectItem value="ETH">ETH</SelectItem>
                    <SelectItem value="JOY">JOY</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>License Type</Label>
                <Select
                  value={assetForm.licenseType}
                  onValueChange={(value) =>
                    setAssetForm((prev) => ({
                      ...prev,
                      licenseType: value as "ownership" | "license" | "rental" | "subscription",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="license">License</SelectItem>
                    <SelectItem value="ownership">Full Ownership</SelectItem>
                    <SelectItem value="rental">Rental</SelectItem>
                    <SelectItem value="subscription">Subscription</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Private Key *</Label>
                <Input
                  type="password"
                  value={assetForm.privateKey}
                  onChange={(e) =>
                    setAssetForm((prev) => ({ ...prev, privateKey: e.target.value }))
                  }
                  placeholder="Your identity private key to sign the listing"
                />
              </div>
            </div>
            <Button
              onClick={() => createAssetListingMutation.mutate()}
              disabled={
                !assetForm.title ||
                !assetForm.privateKey ||
                createAssetListingMutation.isPending
              }
            >
              {createAssetListingMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Publish Asset Listing
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Separator />

        {/* Create Model Chunk Listing */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Puzzle className="w-5 h-5 text-teal-500" />
              Create Model Chunk Listing
            </CardTitle>
            <CardDescription>
              Publish model chunks for federated training and inference
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Title *</Label>
                <Input
                  value={chunkListingForm.title}
                  onChange={(e) =>
                    setChunkListingForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="Llama-3 70B Q4 Chunks"
                />
              </div>
              <div className="space-y-2">
                <Label>Model ID *</Label>
                <Input
                  value={chunkListingForm.modelId}
                  onChange={(e) =>
                    setChunkListingForm((prev) => ({ ...prev, modelId: e.target.value }))
                  }
                  placeholder="model-uuid"
                />
              </div>
              <div className="space-y-2">
                <Label>Model Hash</Label>
                <Input
                  value={chunkListingForm.modelHash}
                  onChange={(e) =>
                    setChunkListingForm((prev) => ({ ...prev, modelHash: e.target.value }))
                  }
                  placeholder="sha256:..."
                />
              </div>
              <div className="space-y-2">
                <Label>Chunk CIDs * (comma-separated)</Label>
                <Input
                  value={chunkListingForm.chunkCids}
                  onChange={(e) =>
                    setChunkListingForm((prev) => ({ ...prev, chunkCids: e.target.value }))
                  }
                  placeholder="bafy..., bafy..."
                />
              </div>
              <div className="space-y-2">
                <Label>Chunk Count</Label>
                <Input
                  type="number"
                  value={chunkListingForm.chunkCount}
                  onChange={(e) =>
                    setChunkListingForm((prev) => ({
                      ...prev,
                      chunkCount: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Total Bytes</Label>
                <Input
                  type="number"
                  value={chunkListingForm.bytesTotal}
                  onChange={(e) =>
                    setChunkListingForm((prev) => ({
                      ...prev,
                      bytesTotal: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Tags (comma-separated)</Label>
                <Input
                  value={chunkListingForm.tags}
                  onChange={(e) =>
                    setChunkListingForm((prev) => ({ ...prev, tags: e.target.value }))
                  }
                  placeholder="llama, quantized, 70b"
                />
              </div>
              <div className="space-y-2">
                <Label>Price</Label>
                <Input
                  type="number"
                  value={chunkListingForm.price}
                  onChange={(e) =>
                    setChunkListingForm((prev) => ({
                      ...prev,
                      price: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select
                  value={chunkListingForm.currency}
                  onValueChange={(value) =>
                    setChunkListingForm((prev) => ({ ...prev, currency: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USDC">USDC</SelectItem>
                    <SelectItem value="ETH">ETH</SelectItem>
                    <SelectItem value="JOY">JOY</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>License Type</Label>
                <Select
                  value={chunkListingForm.licenseType}
                  onValueChange={(value) =>
                    setChunkListingForm((prev) => ({
                      ...prev,
                      licenseType: value as "training" | "inference" | "research" | "non-commercial" | "custom",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="training">Training</SelectItem>
                    <SelectItem value="inference">Inference</SelectItem>
                    <SelectItem value="research">Research</SelectItem>
                    <SelectItem value="non-commercial">Non-Commercial</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Private Key *</Label>
                <Input
                  type="password"
                  value={chunkListingForm.privateKey}
                  onChange={(e) =>
                    setChunkListingForm((prev) => ({ ...prev, privateKey: e.target.value }))
                  }
                  placeholder="Your identity private key to sign the listing"
                />
              </div>
            </div>
            <Button
              onClick={() => createChunkListingMutation.mutate()}
              disabled={
                !chunkListingForm.title ||
                !chunkListingForm.modelId ||
                !chunkListingForm.chunkCids ||
                !chunkListingForm.privateKey ||
                createChunkListingMutation.isPending
              }
            >
              {createChunkListingMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Publish Chunk Listing
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
