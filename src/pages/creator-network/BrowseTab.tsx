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
  CardFooter,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  ShoppingCart,
  RefreshCw,
  Lock,
  Star,
  Puzzle,
} from "lucide-react";
import { toast } from "sonner";
import type {
  P2PListing,
  ModelChunkListing,
  ModelChunkPurchase,
} from "@/types/federation_types";

export default function BrowseTab() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedListing, setSelectedListing] = useState<P2PListing | null>(null);
  const [showBuyDialog, setShowBuyDialog] = useState(false);
  const [selectedChunkListing, setSelectedChunkListing] = useState<ModelChunkListing | null>(null);
  const [showChunkPurchaseDialog, setShowChunkPurchaseDialog] = useState(false);
  const [chunkPurchaseForm, setChunkPurchaseForm] = useState({
    paymentTxHash: "",
    receiptCid: "",
  });

  const { data: identity } = useQuery({
    queryKey: ["federation-identity"],
    queryFn: () => FederationClient.getIdentity(),
  });

  const { data: listings = [] } = useQuery({
    queryKey: ["federation-listings", searchQuery],
    queryFn: () =>
      searchQuery
        ? FederationClient.searchListings({ keyword: searchQuery })
        : FederationClient.getListings(),
  });

  const { data: chunkListings = [] } = useQuery<ModelChunkListing[]>({
    queryKey: ["federation-model-chunk-listings"],
    queryFn: () => FederationClient.listModelChunkListings(),
  });

  const { data: chunkPurchases = [] } = useQuery<ModelChunkPurchase[]>({
    queryKey: ["federation-model-chunk-purchases"],
    queryFn: () => FederationClient.listModelChunkPurchases(),
  });

  const buyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedListing) throw new Error("No listing selected");
      return FederationClient.quickBuy(selectedListing.id, "demo-private-key", true);
    },
    onSuccess: (result) => {
      toast.success(`Transaction initiated! ID: ${result.transaction.id.slice(0, 12)}...`);
      queryClient.invalidateQueries({ queryKey: ["federation-transactions"] });
      setShowBuyDialog(false);
      setSelectedListing(null);
    },
    onError: (error) => {
      toast.error(`Transaction failed: ${error.message}`);
    },
  });

  const createChunkPurchaseMutation = useMutation({
    mutationFn: () => {
      if (!selectedChunkListing || !identity?.did) {
        throw new Error("Listing and identity are required");
      }
      return FederationClient.createModelChunkPurchase({
        listingId: selectedChunkListing.id,
        buyerDid: identity.did,
        paymentTxHash: chunkPurchaseForm.paymentTxHash || undefined,
        receiptCid: chunkPurchaseForm.receiptCid || undefined,
      });
    },
    onSuccess: (purchase) => {
      toast.success("Purchase initiated");
      queryClient.invalidateQueries({ queryKey: ["federation-model-chunk-purchases"] });
      setShowChunkPurchaseDialog(false);
      setSelectedChunkListing(null);
      setChunkPurchaseForm({ paymentTxHash: "", receiptCid: "" });
      if (purchase?.id) {
        FederationClient.createModelChunkEscrow(purchase.id).catch(() => {});
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to initiate purchase");
    },
  });

  const getReputationColor = (score: number) => {
    if (score >= 90) return "text-green-500";
    if (score >= 70) return "text-yellow-500";
    return "text-red-500";
  };

  // Sort listings
  const sortedListings = [...listings].sort((a, b) => {
    if (sortBy === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (sortBy === "price-low") return (a.pricing.base_price ?? 0) - (b.pricing.base_price ?? 0);
    if (sortBy === "price-high") return (b.pricing.base_price ?? 0) - (a.pricing.base_price ?? 0);
    return 0;
  });

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Search & Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search listings..."
              className="pl-10"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="model">Models</SelectItem>
              <SelectItem value="dataset">Datasets</SelectItem>
              <SelectItem value="agent">Agents</SelectItem>
              <SelectItem value="workflow">Workflows</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="price-low">Price: Low → High</SelectItem>
              <SelectItem value="price-high">Price: High → Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Asset Listings */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Asset Listings</h3>
          {sortedListings.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No listings found. Be the first to publish on the Publish tab!
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {sortedListings.map((listing) => (
                <Card key={listing.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="text-xs">
                            {listing.seller.display_name?.slice(0, 2).toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{listing.seller.display_name}</p>
                          <p className={`text-xs ${getReputationColor(listing.seller.reputation_score)}`}>
                            <Star className="w-3 h-3 inline mr-0.5" />
                            {listing.seller.reputation_score}
                          </p>
                        </div>
                      </div>
                      <Badge variant={listing.status === "active" ? "default" : "secondary"}>
                        {listing.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pb-3">
                    <p className="text-sm font-medium">{listing.asset_id}</p>
                    <div className="flex items-center gap-3 mt-2 text-sm">
                      <span className="font-bold">
                        {listing.pricing.base_price} {listing.pricing.preferred_currency.symbol}
                      </span>
                      <Badge variant="outline" className="text-xs capitalize">
                        {listing.license.type}
                      </Badge>
                      <Badge variant="outline" className="text-xs capitalize">
                        {listing.delivery_method}
                      </Badge>
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedListing(listing);
                        setShowBuyDialog(true);
                      }}
                      disabled={listing.status !== "active"}
                    >
                      <ShoppingCart className="w-3 h-3 mr-1" />
                      Buy
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Model Chunk Listings */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Model Chunk Listings</h3>
          {chunkListings.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No model chunk listings available.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {chunkListings.map((listing) => (
                <Card key={listing.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Puzzle className="w-4 h-4 text-teal-500" />
                      {listing.title}
                    </CardTitle>
                    <CardDescription>
                      {listing.chunk_count} chunks
                      {listing.bytes_total
                        ? ` • ${(listing.bytes_total / 1024 / 1024 / 1024).toFixed(1)} GB`
                        : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-bold">
                        {listing.pricing.base_price} {listing.pricing.preferred_currency.symbol}
                      </span>
                      <Badge variant="outline" className="text-xs capitalize">
                        {listing.license.type}
                      </Badge>
                    </div>
                    {listing.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {listing.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedChunkListing(listing);
                        setShowChunkPurchaseDialog(true);
                      }}
                      disabled={listing.status !== "active"}
                    >
                      <ShoppingCart className="w-3 h-3 mr-1" />
                      Purchase
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}

          {/* Recent Purchases */}
          {chunkPurchases.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">Recent Purchases</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {chunkPurchases.slice(0, 5).map((purchase) => (
                  <div key={purchase.id} className="text-xs text-muted-foreground">
                    {purchase.id} • {purchase.status} • {purchase.amount} {purchase.currency.symbol}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Buy Dialog */}
        <Dialog open={showBuyDialog} onOpenChange={setShowBuyDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Purchase Asset</DialogTitle>
              <DialogDescription>
                Review the listing details before purchasing
              </DialogDescription>
            </DialogHeader>

            {selectedListing && (
              <div className="space-y-4 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Seller</span>
                  <div className="flex items-center gap-2">
                    <span>{selectedListing.seller.display_name}</span>
                    <span className={getReputationColor(selectedListing.seller.reputation_score)}>
                      <Star className="w-3 h-3 inline" /> {selectedListing.seller.reputation_score}
                    </span>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span className="font-bold text-lg">
                    {selectedListing.pricing.base_price}{" "}
                    {selectedListing.pricing.preferred_currency.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">License</span>
                  <span className="capitalize">{selectedListing.license.type}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Delivery</span>
                  <span className="capitalize">{selectedListing.delivery_method}</span>
                </div>
                <Separator />
                <div className="bg-muted p-3 rounded-lg">
                  <div className="flex items-center gap-2 text-sm">
                    <Lock className="w-4 h-4 text-green-500" />
                    <span>Protected by escrow</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Funds are held securely until you confirm delivery
                  </p>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowBuyDialog(false)}>
                Cancel
              </Button>
              <Button onClick={() => buyMutation.mutate()} disabled={buyMutation.isPending}>
                {buyMutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    Confirm Purchase
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Model Chunk Purchase Dialog */}
        <Dialog open={showChunkPurchaseDialog} onOpenChange={setShowChunkPurchaseDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Purchase Model Chunks</DialogTitle>
              <DialogDescription>
                Confirm the listing and provide payment proof.
              </DialogDescription>
            </DialogHeader>

            {selectedChunkListing && (
              <div className="space-y-4 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Listing</span>
                  <span className="font-medium">{selectedChunkListing.title}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span className="font-medium">
                    {selectedChunkListing.pricing.base_price || 0}{" "}
                    {selectedChunkListing.pricing.preferred_currency.symbol}
                  </span>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>Payment Tx Hash (optional)</Label>
                  <Input
                    value={chunkPurchaseForm.paymentTxHash}
                    onChange={(e) =>
                      setChunkPurchaseForm((prev) => ({
                        ...prev,
                        paymentTxHash: e.target.value,
                      }))
                    }
                    placeholder="0x..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Receipt CID (optional)</Label>
                  <Input
                    value={chunkPurchaseForm.receiptCid}
                    onChange={(e) =>
                      setChunkPurchaseForm((prev) => ({
                        ...prev,
                        receiptCid: e.target.value,
                      }))
                    }
                    placeholder="bafy..."
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowChunkPurchaseDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createChunkPurchaseMutation.mutate()}
                disabled={createChunkPurchaseMutation.isPending}
              >
                {createChunkPurchaseMutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    Confirm Purchase
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}
