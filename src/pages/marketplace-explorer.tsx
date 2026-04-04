/**
 * Marketplace Explorer — Browse, search, and install assets from JoyMarketplace.
 */

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Search,
  Download,
  Star,
  ShoppingBag,
  Loader2,
  Filter,
  TrendingUp,
  ArrowUpDown,
  ExternalLink,
  Bot,
  Workflow,
  Database,
  Brain,
  AppWindow,
  Package,
} from "lucide-react";
import {
  useMarketplaceBrowse,
  useMarketplaceFeatured,
  useMarketplaceCategories,
  useInstallAsset,
} from "@/hooks/use_marketplace_browse";
import type {
  MarketplaceBrowseParams,
  MarketplaceBrowseItem,
  PublishableAssetType,
  UnifiedCategory,
} from "@/types/publish_types";
import type { PricingModel } from "@/types/marketplace_types";

const ASSET_TYPE_ICONS: Record<string, React.ElementType> = {
  app: AppWindow,
  agent: Bot,
  workflow: Workflow,
  dataset: Database,
  model: Brain,
  template: Package,
  component: Package,
  plugin: Package,
};

const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "recent", label: "Most Recent" },
  { value: "rating", label: "Highest Rated" },
  { value: "price-low", label: "Price: Low to High" },
  { value: "price-high", label: "Price: High to Low" },
];

export default function MarketplaceExplorerPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<UnifiedCategory | "all">("all");
  const [assetType, setAssetType] = useState<PublishableAssetType | "all">("all");
  const [sortBy, setSortBy] = useState<MarketplaceBrowseParams["sortBy"]>("popular");
  const [pricingFilter, setPricingFilter] = useState<PricingModel | "all">("all");
  const [page, setPage] = useState(1);

  const params: MarketplaceBrowseParams = {
    query: query || undefined,
    category: category === "all" ? undefined : category,
    assetType: assetType === "all" ? undefined : assetType,
    sortBy,
    pricingModel: pricingFilter === "all" ? undefined : pricingFilter,
    page,
    pageSize: 24,
  };

  const { data: browseResult, isLoading } = useMarketplaceBrowse(params);
  const { data: featured } = useMarketplaceFeatured();
  const { data: categories } = useMarketplaceCategories();
  const installAsset = useInstallAsset();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-gradient-to-r from-violet-600/10 via-fuchsia-600/10 to-pink-600/10 px-6 py-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <ShoppingBag className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">JoyMarketplace</h1>
              <p className="text-sm text-muted-foreground">
                Explore apps, agents, workflows, datasets, and models built by the Joy community
              </p>
            </div>
          </div>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex gap-2 max-w-2xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                data-joy-assist="marketplace-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search marketplace..."
                className="pl-10"
              />
            </div>
            <Button type="submit" data-joy-assist="marketplace-search-btn">Search</Button>
          </form>
        </div>
      </div>

      {/* Filters */}
      <div className="border-b px-6 py-3">
        <div className="max-w-5xl mx-auto flex flex-wrap gap-3 items-center">
          <Filter className="w-4 h-4 text-muted-foreground" />

          <Select value={assetType} onValueChange={(v) => { setAssetType(v as any); setPage(1); }}>
            <SelectTrigger className="w-[140px]" data-joy-assist="marketplace-filter-type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="app">Apps</SelectItem>
              <SelectItem value="agent">Agents</SelectItem>
              <SelectItem value="workflow">Workflows</SelectItem>
              <SelectItem value="dataset">Datasets</SelectItem>
              <SelectItem value="model">Models</SelectItem>
              <SelectItem value="template">Templates</SelectItem>
            </SelectContent>
          </Select>

          <Select value={category} onValueChange={(v) => { setCategory(v as any); setPage(1); }}>
            <SelectTrigger className="w-[160px]" data-joy-assist="marketplace-filter-category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {(categories ?? []).map((c: any) => (
                <SelectItem key={c.category} value={c.category}>
                  {c.category} ({c.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={pricingFilter} onValueChange={(v) => { setPricingFilter(v as any); setPage(1); }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Pricing" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Price</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="one-time">One-Time</SelectItem>
              <SelectItem value="subscription">Subscription</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(v) => { setSortBy(v as any); setPage(1); }}>
            <SelectTrigger className="w-[170px]">
              <ArrowUpDown className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl mx-auto">
          {/* Featured section (only on first page, no search) */}
          {page === 1 && !query && featured?.items?.length ? (
            <div className="mb-8">
              <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-violet-500" />
                Featured
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {featured.items.slice(0, 6).map((item: MarketplaceBrowseItem) => (
                  <AssetCard
                    key={item.id}
                    item={item}
                    onInstall={() =>
                      installAsset.mutate({ assetId: item.id, assetType: item.assetType })
                    }
                    isInstalling={installAsset.isPending}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Browse results */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {query ? `Results for "${query}"` : "All Assets"}
                {browseResult?.total ? (
                  <span className="text-sm text-muted-foreground font-normal ml-2">
                    ({browseResult.total.toLocaleString()} found)
                  </span>
                ) : null}
              </h2>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : browseResult?.items?.length ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {browseResult.items.map((item) => (
                    <AssetCard
                      key={item.id}
                      item={item}
                      onInstall={() =>
                        installAsset.mutate({ assetId: item.id, assetType: item.assetType })
                      }
                      isInstalling={installAsset.isPending}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {browseResult.hasMore && (
                  <div className="flex justify-center mt-8 gap-2">
                    <Button
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <span className="flex items-center px-4 text-sm text-muted-foreground">
                      Page {page}
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-20 text-muted-foreground">
                <ShoppingBag className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <p className="text-lg font-medium">No assets found</p>
                <p className="text-sm mt-1">Try adjusting your filters or search query</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset Card
// ---------------------------------------------------------------------------

function AssetCard({
  item,
  onInstall,
  isInstalling,
}: {
  item: MarketplaceBrowseItem;
  onInstall: () => void;
  isInstalling: boolean;
}) {
  const Icon = ASSET_TYPE_ICONS[item.assetType] ?? Package;

  return (
    <div className="group rounded-xl border bg-card hover:shadow-md transition-shadow p-4 flex flex-col">
      {/* Thumbnail area */}
      <div className="aspect-video rounded-lg bg-muted mb-3 flex items-center justify-center overflow-hidden">
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <Icon className="w-10 h-10 text-muted-foreground/40" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm line-clamp-1">{item.name}</h3>
          <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0">
            {item.assetType}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
          {item.shortDescription}
        </p>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
          {item.rating.toFixed(1)}
        </span>
        <span className="flex items-center gap-1">
          <Download className="w-3 h-3" />
          {item.downloads.toLocaleString()}
        </span>
        <span className="ml-auto font-medium text-foreground">
          {item.pricingModel === "free"
            ? "Free"
            : `$${((item.price ?? 0) / 100).toFixed(2)}`}
        </span>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t">
        <span className="text-xs text-muted-foreground truncate flex-1">
          by {item.publisherName}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onInstall}
          disabled={isInstalling}
        >
          {isInstalling ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <>
              <Download className="w-3 h-3 mr-1" />
              Install
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
