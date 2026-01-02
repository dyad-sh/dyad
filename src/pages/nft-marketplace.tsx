/**
 * NFT Marketplace Page
 * List, sell, and manage NFT assets on JoyMarketplace
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NFTClient } from "@/ipc/nft_client";
import { AssetStudioClient } from "@/ipc/asset_studio_client";
import { IpcClient } from "@/ipc/ipc_client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  Coins,
  Package2,
  TrendingUp,
  Layers,
  Upload,
  Eye,
  Trash2,
  ExternalLink,
  DollarSign,
  Tag,
  Wallet,
  Blocks,
  RefreshCw,
  Grid3X3,
  List,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import type { Asset, AssetType } from "@/types/asset_types";
import type {
  NFTListing,
  NFTPricing,
  NFTLicenseType,
  BlockchainNetwork,
  AssetChunk,
} from "@/types/nft_types";

const nftClient = NFTClient;
const assetClient = AssetStudioClient;
const ipcClient = IpcClient.getInstance();

const LICENSE_OPTIONS: { value: NFTLicenseType; label: string; description: string }[] = [
  { value: "full-ownership", label: "Full Ownership", description: "Complete transfer of all rights" },
  { value: "commercial-use", label: "Commercial Use", description: "Can use for commercial purposes" },
  { value: "personal-use", label: "Personal Use", description: "Non-commercial use only" },
  { value: "derivative-allowed", label: "Derivative Allowed", description: "Can create derivatives" },
  { value: "view-only", label: "View Only", description: "No modification or redistribution" },
  { value: "limited-uses", label: "Limited Uses", description: "Fixed number of uses" },
  { value: "time-limited", label: "Time Limited", description: "Access expires after period" },
  { value: "subscription", label: "Subscription", description: "Recurring access fee" },
];

const NETWORK_OPTIONS: { value: BlockchainNetwork; label: string }[] = [
  { value: "joy-chain", label: "Joy Chain (Native)" },
  { value: "ethereum", label: "Ethereum" },
  { value: "polygon", label: "Polygon" },
  { value: "base", label: "Base" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "solana", label: "Solana" },
];

const PRICING_TYPES = [
  { value: "fixed", label: "Fixed Price" },
  { value: "auction", label: "Auction" },
  { value: "pay-per-use", label: "Pay Per Use" },
  { value: "subscription", label: "Subscription" },
];

export default function NFTMarketplacePage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("listings");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showListDialog, setShowListDialog] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isChunking, setIsChunking] = useState(false);
  const [chunkingProgress, setChunkingProgress] = useState(0);
  
  // List form state
  const [listForm, setListForm] = useState({
    priceType: "fixed" as NFTPricing["type"],
    price: 0,
    currency: "USD",
    license: "commercial-use" as NFTLicenseType,
    network: "joy-chain" as BlockchainNetwork,
    autoPublish: false,
    maxUses: 100,
    expiresInDays: 30,
  });

  // Queries
  const { data: stats } = useQuery({
    queryKey: ["nft-stats"],
    queryFn: () => nftClient.getStats(),
  });

  const { data: listings = [], isLoading: listingsLoading, refetch: refetchListings } = useQuery({
    queryKey: ["nft-listings"],
    queryFn: () => nftClient.getAllListings(),
  });

  const { data: assets = [] } = useQuery({
    queryKey: ["all-assets"],
    queryFn: () => assetClient.listAll(),
  });

  const { data: portfolio } = useQuery({
    queryKey: ["nft-portfolio"],
    queryFn: () => nftClient.getPortfolio(),
  });

  // Mutations
  const chunkAndListMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAsset) throw new Error("No asset selected");
      
      setIsChunking(true);
      setChunkingProgress(20);
      
      // Chunk the asset
      const chunkResult = await nftClient.chunkAsset(selectedAsset);
      if (!chunkResult.success) {
        throw new Error(chunkResult.errors?.join(", ") || "Failed to chunk asset");
      }
      
      setChunkingProgress(50);
      
      // Create pricing object
      const pricing: NFTPricing = {
        type: listForm.priceType,
        price: listForm.price,
        currency: listForm.currency,
      };
      
      if (listForm.priceType === "pay-per-use") {
        pricing.max_uses = listForm.maxUses;
      }
      if (listForm.priceType === "subscription") {
        pricing.subscription_period = "monthly";
      }
      
      setChunkingProgress(70);
      
      // Create listings
      const listings = await nftClient.bulkCreateListings({
        asset: selectedAsset,
        pricing,
        license: listForm.license,
        network: listForm.network,
      });
      
      setChunkingProgress(100);
      
      return { chunks: chunkResult.chunks, listings };
    },
    onSuccess: (result) => {
      toast.success(`Created ${result.listings.length} NFT listings from ${result.chunks.length} chunks`);
      queryClient.invalidateQueries({ queryKey: ["nft-listings"] });
      queryClient.invalidateQueries({ queryKey: ["nft-stats"] });
      setShowListDialog(false);
      setSelectedAsset(null);
      setIsChunking(false);
      setChunkingProgress(0);
    },
    onError: (error) => {
      toast.error(`Failed to create NFT: ${error.message}`);
      setIsChunking(false);
      setChunkingProgress(0);
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (listingId: string) => {
      // TODO: Get API key from settings
      return nftClient.publish(listingId, "demo-api-key");
    },
    onSuccess: () => {
      toast.success("Listed on JoyMarketplace!");
      queryClient.invalidateQueries({ queryKey: ["nft-listings"] });
    },
    onError: (error) => {
      toast.error(`Failed to publish: ${error.message}`);
    },
  });

  const deleteListingMutation = useMutation({
    mutationFn: (listingId: string) => nftClient.deleteListing(listingId),
    onSuccess: () => {
      toast.success("Listing deleted");
      queryClient.invalidateQueries({ queryKey: ["nft-listings"] });
      queryClient.invalidateQueries({ queryKey: ["nft-stats"] });
    },
  });

  const getStatusColor = (status: NFTListing["status"]) => {
    switch (status) {
      case "draft": return "bg-gray-500";
      case "listed": return "bg-green-500";
      case "sold": return "bg-blue-500";
      case "delisted": return "bg-yellow-500";
      default: return "bg-gray-500";
    }
  };

  const formatPrice = (pricing: NFTPricing) => {
    if (pricing.type === "auction") {
      return `Starting at ${pricing.currency} ${pricing.price || 0}`;
    }
    if (pricing.type === "pay-per-use") {
      return `${pricing.currency} ${pricing.price_per_use || pricing.price || 0}/use`;
    }
    if (pricing.type === "subscription") {
      return `${pricing.currency} ${pricing.price || 0}/mo`;
    }
    return `${pricing.currency} ${pricing.price || 0}`;
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Coins className="w-6 h-6 text-purple-500" />
              NFT Marketplace
            </h1>
            <p className="text-muted-foreground text-sm">
              Tokenize your assets and list them on JoyMarketplace
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetchListings()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button onClick={() => setShowListDialog(true)}>
              <Upload className="w-4 h-4 mr-2" />
              List Asset as NFT
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 p-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Listings</p>
                <p className="text-2xl font-bold">{stats?.total_listings || 0}</p>
              </div>
              <Package2 className="w-8 h-8 text-purple-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Listings</p>
                <p className="text-2xl font-bold">{stats?.listed_count || 0}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold">${stats?.total_value?.toFixed(2) || "0.00"}</p>
              </div>
              <DollarSign className="w-8 h-8 text-yellow-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sales</p>
                <p className="text-2xl font-bold">{stats?.sold_count || 0}</p>
              </div>
              <Wallet className="w-8 h-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="listings">My Listings</TabsTrigger>
              <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
              <TabsTrigger value="marketplace">Browse Marketplace</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("grid")}
              >
                <Grid3X3 className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("list")}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <TabsContent value="listings">
            {listingsLoading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
            ) : listings.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center h-64">
                  <Layers className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">No NFT Listings Yet</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Create your first NFT listing from your assets
                  </p>
                  <Button onClick={() => setShowListDialog(true)}>
                    <Upload className="w-4 h-4 mr-2" />
                    List Your First Asset
                  </Button>
                </CardContent>
              </Card>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-3 gap-4">
                {listings.map((listing) => (
                  <Card key={listing.id} className="hover:border-purple-500 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-sm truncate">
                            {listing.metadata.name}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {listing.metadata.properties?.category || "Asset"}
                          </CardDescription>
                        </div>
                        <Badge className={`${getStatusColor(listing.status)} text-white`}>
                          {listing.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="aspect-video bg-muted rounded-lg flex items-center justify-center mb-3">
                        <Blocks className="w-12 h-12 text-muted-foreground" />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Price</span>
                          <span className="font-medium">{formatPrice(listing.pricing)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Network</span>
                          <span className="font-medium capitalize">{listing.network}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Views</span>
                          <span className="font-medium">{listing.views}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        {listing.status === "draft" && (
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={() => publishMutation.mutate(listing.id)}
                          >
                            <Upload className="w-3 h-3 mr-1" />
                            Publish
                          </Button>
                        )}
                        <Button variant="outline" size="sm">
                          <Eye className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteListingMutation.mutate(listing.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Network</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listings.map((listing) => (
                      <TableRow key={listing.id}>
                        <TableCell className="font-medium">
                          {listing.metadata.name}
                        </TableCell>
                        <TableCell>
                          {listing.metadata.properties?.category || "Asset"}
                        </TableCell>
                        <TableCell>{formatPrice(listing.pricing)}</TableCell>
                        <TableCell className="capitalize">{listing.network}</TableCell>
                        <TableCell>
                          <Badge className={`${getStatusColor(listing.status)} text-white`}>
                            {listing.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(listing.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {listing.status === "draft" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => publishMutation.mutate(listing.id)}
                              >
                                <Upload className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteListingMutation.mutate(listing.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="portfolio">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Owned NFTs</CardTitle>
                  <CardDescription>NFTs you currently own</CardDescription>
                </CardHeader>
                <CardContent>
                  {portfolio?.owned?.length ? (
                    <div className="space-y-2">
                      {portfolio.owned.map((item, i) => (
                        <div key={i} className="flex items-center justify-between p-2 border rounded">
                          <span className="text-sm">{item.listing_id}</span>
                          <span className="text-sm font-medium">
                            ${item.acquisition_price?.toFixed(2) || "0.00"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">No owned NFTs yet</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Created NFTs</CardTitle>
                  <CardDescription>NFTs you've created and listed</CardDescription>
                </CardHeader>
                <CardContent>
                  {portfolio?.created?.length ? (
                    <div className="space-y-2">
                      {portfolio.created.map((item, i) => (
                        <div key={i} className="flex items-center justify-between p-2 border rounded">
                          <span className="text-sm">{item.listing_id}</span>
                          <span className="text-sm font-medium">
                            {item.total_sales} sales
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">No created NFTs yet</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="marketplace">
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-64">
                <ExternalLink className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">Browse JoyMarketplace</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Explore and purchase assets from other creators
                </p>
                <Button
                  onClick={() => ipcClient.openExternalUrl("https://joymarketplace.io")}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Marketplace
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* List Asset Dialog */}
      <Dialog open={showListDialog} onOpenChange={setShowListDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>List Asset as NFT</DialogTitle>
            <DialogDescription>
              Select an asset to chunk and list on JoyMarketplace
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Asset Selection */}
            <div className="space-y-2">
              <Label>Select Asset</Label>
              <Select
                value={selectedAsset?.id || ""}
                onValueChange={(value) => {
                  const asset = assets.find((a: Asset) => a.id === value);
                  setSelectedAsset(asset || null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose an asset to tokenize..." />
                </SelectTrigger>
                <SelectContent>
                  {assets.map((asset: Asset) => (
                    <SelectItem key={asset.id} value={asset.id}>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{asset.type}</Badge>
                        {asset.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedAsset && (
              <>
                {/* Pricing */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pricing Type</Label>
                    <Select
                      value={listForm.priceType}
                      onValueChange={(value: NFTPricing["type"]) =>
                        setListForm({ ...listForm, priceType: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRICING_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Price (USD)</Label>
                    <Input
                      type="number"
                      value={listForm.price}
                      onChange={(e) =>
                        setListForm({ ...listForm, price: parseFloat(e.target.value) || 0 })
                      }
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* License */}
                <div className="space-y-2">
                  <Label>License Type</Label>
                  <Select
                    value={listForm.license}
                    onValueChange={(value: NFTLicenseType) =>
                      setListForm({ ...listForm, license: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LICENSE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div>
                            <div className="font-medium">{opt.label}</div>
                            <div className="text-xs text-muted-foreground">{opt.description}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Network */}
                <div className="space-y-2">
                  <Label>Blockchain Network</Label>
                  <Select
                    value={listForm.network}
                    onValueChange={(value: BlockchainNetwork) =>
                      setListForm({ ...listForm, network: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NETWORK_OPTIONS.map((net) => (
                        <SelectItem key={net.value} value={net.value}>
                          {net.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Chunking Progress */}
                {isChunking && (
                  <div className="space-y-2">
                    <Label>Processing...</Label>
                    <Progress value={chunkingProgress} />
                    <p className="text-sm text-muted-foreground">
                      {chunkingProgress < 50
                        ? "Chunking asset..."
                        : chunkingProgress < 100
                        ? "Creating NFT listings..."
                        : "Complete!"}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowListDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => chunkAndListMutation.mutate()}
              disabled={!selectedAsset || isChunking}
            >
              {isChunking ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Coins className="w-4 h-4 mr-2" />
                  Create NFT Listing
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
