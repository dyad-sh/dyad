/**
 * My Marketplace Assets — Comprehensive on-chain asset dashboard.
 *
 * Shows tokens owned, purchases, stores, .joy domains, and network stats
 * by querying the Goldsky-indexed Joy Marketplace subgraphs.
 */

import React, { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Coins,
  Store,
  Globe,
  ShoppingCart,
  BarChart3,
  Wallet,
  RefreshCw,
  ExternalLink,
  Copy,
  AlertCircle,
  Search,
  Image as ImageIcon,
  Clock,
  Hash,
  LinkIcon,
} from "lucide-react";
import {
  useMyMarketplaceAssets,
  useSubgraphTokens,
  useDropStats,
  useStoreStats,
  useAllStores,
  useAllDomains,
} from "@/hooks/use_subgraph";
import { useQueryClient } from "@tanstack/react-query";
import { subgraphKeys } from "@/hooks/use_subgraph";
import type {
  SubgraphToken,
  SubgraphPurchase,
  SubgraphUserBalance,
  SubgraphStore,
  SubgraphDomainRegistration,
} from "@/types/subgraph_types";

// ── Helpers ────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  const n = Number(ts);
  if (Number.isNaN(n)) return "—";
  return new Date(n * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ipfsToHttp(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  }
  return uri;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}

// ── Token Card ─────────────────────────────────────────────────────────────

function TokenCard({ token, owned }: { token: SubgraphToken; owned?: boolean }) {
  const httpUri = ipfsToHttp(token.baseURI);

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="aspect-square bg-muted/50 flex items-center justify-center relative">
        {httpUri ? (
          <img
            src={httpUri}
            alt={`Token #${token.tokenId}`}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
            }}
          />
        ) : null}
        <div className={cn("flex flex-col items-center gap-2 text-muted-foreground", httpUri && "hidden")}>
          <ImageIcon className="h-10 w-10" />
          <span className="text-xs">Token #{token.tokenId}</span>
        </div>
        {owned && (
          <Badge className="absolute top-2 right-2 bg-green-500/90">Owned</Badge>
        )}
      </div>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Token #{token.tokenId}</span>
          <Badge variant="outline" className="text-xs">
            {token.supplyClaimed ?? 0}/{token.maxClaimableSupply ?? "∞"}
          </Badge>
        </div>
        {token.pricePerToken && (
          <div className="text-sm text-muted-foreground">
            Price: {token.pricePerToken} {token.currency === "0x0000000000000000000000000000000000000000" ? "Native" : "ERC20"}
          </div>
        )}
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatTimestamp(token.lazyMintedAt)}
        </div>
        {Number(token.totalPurchases) > 0 && (
          <div className="text-xs text-muted-foreground">
            {token.totalPurchases} purchase{token.totalPurchases !== "1" ? "s" : ""}
          </div>
        )}
        {httpUri && (
          <a
            href={httpUri}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" /> View metadata
          </a>
        )}
      </CardContent>
    </Card>
  );
}

// ── Purchase Row ───────────────────────────────────────────────────────────

function PurchaseRow({ purchase }: { purchase: SubgraphPurchase }) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
          <ShoppingCart className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-medium">Token #{purchase.tokenId}</div>
          <div className="text-xs text-muted-foreground">Qty: {purchase.quantity}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs text-muted-foreground">{formatTimestamp(purchase.timestamp)}</div>
        <button
          onClick={() => copyToClipboard(purchase.txHash)}
          className="text-xs text-blue-500 hover:underline flex items-center gap-1"
        >
          <Hash className="h-3 w-3" />
          {truncateAddress(purchase.txHash)}
        </button>
      </div>
    </div>
  );
}

// ── Store Card ─────────────────────────────────────────────────────────────

function StoreCard({ store, isOwned }: { store: SubgraphStore; isOwned?: boolean }) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {store.logo ? (
              <img
                src={ipfsToHttp(store.logo) ?? ""}
                alt={store.name || "Store"}
                className="h-10 w-10 rounded-lg object-cover"
              />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <Store className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <CardTitle className="text-base">{store.name || store.domain || "Unnamed Store"}</CardTitle>
              {store.domain && (
                <CardDescription className="flex items-center gap-1">
                  <Globe className="h-3 w-3" /> {store.domain}
                </CardDescription>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {isOwned && <Badge className="bg-blue-500/90">Your Store</Badge>}
            <Badge variant={store.isActive ? "default" : "secondary"}>
              {store.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {store.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{store.description}</p>
        )}
        {store.tagline && (
          <p className="text-xs italic text-muted-foreground">{store.tagline}</p>
        )}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Wallet className="h-3 w-3" />
            {truncateAddress(store.owner)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimestamp(store.createdAt)}
          </span>
        </div>
        {store.website && (
          <a
            href={store.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
          >
            <LinkIcon className="h-3 w-3" /> {store.website}
          </a>
        )}
      </CardContent>
    </Card>
  );
}

// ── Domain Card ────────────────────────────────────────────────────────────

function DomainCard({ domain, isOwned }: { domain: SubgraphDomainRegistration; isOwned?: boolean }) {
  const isExpired = domain.expiresAt ? Number(domain.expiresAt) * 1000 < Date.now() : false;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-purple-500" />
            <span className="font-semibold text-lg">{domain.fullName || domain.name}</span>
          </div>
          <div className="flex gap-2">
            {isOwned && <Badge className="bg-purple-500/90">Yours</Badge>}
            <Badge variant={isExpired ? "destructive" : "default"}>
              {isExpired ? "Expired" : "Active"}
            </Badge>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="font-medium">Owner:</span>{" "}
            <button
              onClick={() => copyToClipboard(domain.owner)}
              className="text-blue-500 hover:underline"
            >
              {truncateAddress(domain.owner)}
            </button>
          </div>
          {domain.resolvedAddress && (
            <div>
              <span className="font-medium">Resolves to:</span>{" "}
              {truncateAddress(domain.resolvedAddress)}
            </div>
          )}
          <div>
            <span className="font-medium">Registered:</span> {formatTimestamp(domain.registeredAt)}
          </div>
          {domain.expiresAt && (
            <div>
              <span className="font-medium">Expires:</span> {formatTimestamp(domain.expiresAt)}
            </div>
          )}
          {domain.cost && (
            <div>
              <span className="font-medium">Cost:</span> {domain.cost}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Skeleton Loaders ───────────────────────────────────────────────────────

function TokenSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-square w-full" />
      <CardContent className="p-4 space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function MyMarketplaceAssetsPage() {
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [filterText, setFilterText] = useState("");
  const queryClient = useQueryClient();

  // Load wallet from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("joycreate:chat:wallet-address");
    if (stored) setWalletAddress(stored);
  }, []);

  // Queries
  const { data: myAssets, isLoading, error, refetch } = useMyMarketplaceAssets(walletAddress || undefined);
  const { data: allTokens } = useSubgraphTokens();
  const { data: dropStats } = useDropStats();
  const { data: storeStats } = useStoreStats();
  const { data: allStores } = useAllStores();
  const { data: allDomains } = useAllDomains();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: subgraphKeys.all });
    refetch();
  };

  const handleWalletConnect = (e: React.FormEvent) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem("wallet") as HTMLInputElement;
    const addr = input?.value?.trim();
    if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setWalletAddress(addr);
      localStorage.setItem("joycreate:chat:wallet-address", addr);
    }
  };

  // Filter helpers
  const filterTokens = (tokens: SubgraphToken[] | undefined) =>
    tokens?.filter(
      (t) =>
        !filterText ||
        t.tokenId?.includes(filterText) ||
        t.baseURI?.toLowerCase().includes(filterText.toLowerCase()),
    ) ?? [];

  const filterStores = (stores: SubgraphStore[] | undefined) =>
    stores?.filter(
      (s) =>
        !filterText ||
        s.name?.toLowerCase().includes(filterText.toLowerCase()) ||
        s.domain?.toLowerCase().includes(filterText.toLowerCase()) ||
        s.description?.toLowerCase().includes(filterText.toLowerCase()),
    ) ?? [];

  const filterDomains = (domains: SubgraphDomainRegistration[] | undefined) =>
    domains?.filter(
      (d) =>
        !filterText ||
        d.name?.toLowerCase().includes(filterText.toLowerCase()) ||
        d.fullName?.toLowerCase().includes(filterText.toLowerCase()) ||
        d.owner?.toLowerCase().includes(filterText.toLowerCase()),
    ) ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-6 pb-0">
        <div>
          <h1 className="text-2xl font-bold">My Marketplace Assets</h1>
          <p className="text-muted-foreground text-sm mt-1">
            On-chain assets from Joy Marketplace — tokens, stores, domains, and purchases
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Wallet Connection */}
      <div className="px-6 pt-4">
        {walletAddress ? (
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <Wallet className="h-5 w-5 text-green-500" />
            <div className="flex-1">
              <span className="text-sm font-medium">Connected Wallet</span>
              <button
                onClick={() => copyToClipboard(walletAddress)}
                className="ml-2 text-sm text-muted-foreground hover:text-foreground"
              >
                {truncateAddress(walletAddress)}
                <Copy className="h-3 w-3 inline ml-1" />
              </button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setWalletAddress("");
                localStorage.removeItem("joycreate:chat:wallet-address");
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <form onSubmit={handleWalletConnect} className="flex gap-2">
            <Input name="wallet" placeholder="Enter wallet address (0x...)" className="flex-1" />
            <Button type="submit">Connect</Button>
          </form>
        )}
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 pt-4">
        <StatCard
          title="Your Tokens"
          value={myAssets?.ownedTokens?.length ?? 0}
          icon={Coins}
          description="Tokens in your wallet"
        />
        <StatCard
          title="Your Purchases"
          value={myAssets?.purchases?.length ?? 0}
          icon={ShoppingCart}
          description="On-chain purchase records"
        />
        <StatCard
          title="Your Stores"
          value={myAssets?.stores?.length ?? 0}
          icon={Store}
          description="Marketplace stores"
        />
        <StatCard
          title="Your Domains"
          value={myAssets?.domains?.length ?? 0}
          icon={Globe}
          description=".joy domain names"
        />
      </div>

      {/* Network Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 pt-2">
        <StatCard
          title="Total Tokens"
          value={dropStats?.totalTokens ?? "—"}
          icon={BarChart3}
          description="Network-wide"
        />
        <StatCard
          title="Total Purchases"
          value={dropStats?.totalPurchases ?? "—"}
          icon={ShoppingCart}
          description="Network-wide"
        />
        <StatCard
          title="Total Stores"
          value={storeStats?.totalStores ?? "—"}
          icon={Store}
          description="Network-wide"
        />
        <StatCard
          title="Total Domains"
          value={storeStats?.totalDomains ?? "—"}
          icon={Globe}
          description="Network-wide"
        />
      </div>

      {/* Search */}
      <div className="px-6 pt-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tokens, stores, domains..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-destructive/10 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Failed to load assets: {(error as Error).message}</span>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* Tabbed Content */}
      <div className="flex-1 overflow-auto px-6 pt-4 pb-6">
        <Tabs defaultValue="tokens" className="h-full">
          <TabsList className="mb-4">
            <TabsTrigger value="tokens" className="gap-1">
              <Coins className="h-4 w-4" /> Tokens
            </TabsTrigger>
            <TabsTrigger value="my-tokens" className="gap-1">
              <Wallet className="h-4 w-4" /> My Tokens
            </TabsTrigger>
            <TabsTrigger value="purchases" className="gap-1">
              <ShoppingCart className="h-4 w-4" /> Purchases
            </TabsTrigger>
            <TabsTrigger value="stores" className="gap-1">
              <Store className="h-4 w-4" /> Stores
            </TabsTrigger>
            <TabsTrigger value="domains" className="gap-1">
              <Globe className="h-4 w-4" /> Domains
            </TabsTrigger>
          </TabsList>

          {/* All Tokens */}
          <TabsContent value="tokens" className="mt-0">
            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <TokenSkeleton key={i} />
                ))}
              </div>
            ) : filterTokens(allTokens).length === 0 ? (
              <EmptyState
                icon={Coins}
                title="No tokens found"
                description="No tokens have been minted on the Joy Drop contract yet."
              />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filterTokens(allTokens).map((token) => {
                  const isOwned = myAssets?.ownedTokens?.some(
                    (b) => b.tokenId === token.tokenId,
                  );
                  return <TokenCard key={token.id} token={token} owned={isOwned} />;
                })}
              </div>
            )}
          </TabsContent>

          {/* My Tokens */}
          <TabsContent value="my-tokens" className="mt-0">
            {!walletAddress ? (
              <EmptyState
                icon={Wallet}
                title="Connect your wallet"
                description="Enter your wallet address above to see your token balances."
              />
            ) : isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <TokenSkeleton key={i} />
                ))}
              </div>
            ) : (myAssets?.ownedTokens?.length ?? 0) === 0 ? (
              <EmptyState
                icon={Coins}
                title="No tokens owned"
                description="You haven't claimed any tokens yet. Browse the marketplace to find assets."
              />
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {myAssets!.ownedTokens.map((balance) => (
                    <Card key={balance.id} className="overflow-hidden hover:shadow-md transition-shadow">
                      <div className="aspect-square bg-muted/50 flex items-center justify-center">
                        {balance.token?.baseURI ? (
                          <img
                            src={ipfsToHttp(balance.token.baseURI) ?? ""}
                            alt={`Token #${balance.tokenId}`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <ImageIcon className="h-10 w-10 text-muted-foreground" />
                        )}
                      </div>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">Token #{balance.tokenId}</span>
                          <Badge className="bg-green-500/90">Owned</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Claimed: {balance.totalClaimed}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Last claimed: {formatTimestamp(balance.lastClaimedAt)}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Purchases */}
          <TabsContent value="purchases" className="mt-0">
            {!walletAddress ? (
              <EmptyState
                icon={Wallet}
                title="Connect your wallet"
                description="Enter your wallet address above to see your purchase history."
              />
            ) : isLoading ? (
              <Card>
                <CardContent className="p-4">
                  <ListSkeleton rows={5} />
                </CardContent>
              </Card>
            ) : (myAssets?.purchases?.length ?? 0) === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title="No purchases"
                description="You haven't made any on-chain purchases yet."
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Purchase History</CardTitle>
                  <CardDescription>
                    {myAssets!.purchases.length} transaction{myAssets!.purchases.length !== 1 ? "s" : ""} found
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {myAssets!.purchases.map((p) => (
                    <PurchaseRow key={p.id} purchase={p} />
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Stores */}
          <TabsContent value="stores" className="mt-0">
            {isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-lg" />
                        <div className="space-y-1 flex-1">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filterStores(allStores).length === 0 ? (
              <EmptyState
                icon={Store}
                title="No stores found"
                description="No stores have been created on the Joy Marketplace contract yet."
              />
            ) : (
              <div className="space-y-4">
                {filterStores(allStores).map((store) => {
                  const isOwned =
                    walletAddress &&
                    store.owner.toLowerCase() === walletAddress.toLowerCase();
                  return <StoreCard key={store.id} store={store} isOwned={!!isOwned} />;
                })}
              </div>
            )}
          </TabsContent>

          {/* Domains */}
          <TabsContent value="domains" className="mt-0">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <Skeleton className="h-6 w-40 mb-3" />
                      <div className="grid grid-cols-2 gap-2">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filterDomains(allDomains).length === 0 ? (
              <EmptyState
                icon={Globe}
                title="No domains found"
                description="No .joy domains have been registered yet."
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filterDomains(allDomains).map((domain) => {
                  const isOwned =
                    walletAddress &&
                    domain.owner.toLowerCase() === walletAddress.toLowerCase();
                  return <DomainCard key={domain.id} domain={domain} isOwned={!!isOwned} />;
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
    </div>
  );
}
