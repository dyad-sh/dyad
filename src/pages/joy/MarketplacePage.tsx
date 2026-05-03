/**
 * /joy/marketplace — Public Joy Marketplace browse.
 *
 * Replaces (functionally, not literally — D9 keep-old-pages):
 *   - /marketplace-explorer
 *   - /nft-marketplace (browse half)
 *
 * Backed by `joybridge:browse-marketplace`. No direct subgraph access here;
 * the JoyBridge API layer is responsible for picking subgraph-vs-cache.
 */

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IpcClient } from "@/ipc/ipc_client";
import { ShoppingCart, Search, Sparkles, Filter } from "lucide-react";
import type {
  Asset,
  BrowseQuery,
  BrowseResult,
  Result,
} from "@/lib/joybridge_client";

const ASSET_TYPES = [
  "all",
  "image",
  "video",
  "agent",
  "model",
  "document",
] as const;

export default function JoyMarketplacePage() {
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [assetType, setAssetType] = useState<string>("all");

  async function load(query: BrowseQuery): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const ipc = IpcClient.getInstance();
      const res = (await ipc.invoke(
        "joybridge:browse-marketplace",
        query,
      )) as Result<BrowseResult>;
      if (res?.ok) {
        setItems(res.data?.items ?? []);
      } else {
        setError(res?.error ?? "Failed to load marketplace");
        setItems([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load({ limit: 24 });
  }, []);

  function applyFilters(): void {
    void load({
      limit: 24,
      search: search.trim() || undefined,
      assetType: assetType === "all" ? undefined : assetType,
    });
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-8 w-8 text-purple-500" />
            Joy Marketplace
          </h1>
          <p className="text-muted-foreground">
            Browse assets published from JoyCreate stores.
          </p>
        </div>
        <Link to="/joy/publish">
          <Button>
            <Sparkles className="h-4 w-4 mr-2" />
            Publish an Asset
          </Button>
        </Link>
      </header>

      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-3">
          <div className="flex-1 flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, store, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters();
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={assetType} onValueChange={setAssetType}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSET_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t === "all" ? "All types" : t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={applyFilters} variant="secondary">
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="p-6 text-center text-red-600 dark:text-red-400">
            {error}
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="text-muted-foreground">Loading marketplace…</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground space-y-2">
            <p>No published assets yet.</p>
            <p className="text-sm">
              When you (or anyone) publishes via{" "}
              <Link to="/joy/publish" className="underline">
                /joy/publish
              </Link>
              , assets will show up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((a) => (
            <Card key={a.id} className="overflow-hidden hover:shadow-md transition-shadow">
              {a.thumbnailUrl ? (
                <div className="h-40 bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.thumbnailUrl}
                    alt={a.name}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="h-40 bg-gradient-to-br from-purple-500/20 to-indigo-500/20 flex items-center justify-center">
                  <Sparkles className="h-10 w-10 text-purple-500/50" />
                </div>
              )}
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="truncate">{a.name}</span>
                  <Badge variant="secondary">{a.assetType}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-1">
                {a.description && (
                  <p className="line-clamp-2">{a.description}</p>
                )}
                <div className="flex items-center justify-between pt-2">
                  <span>
                    {a.priceUsdc != null
                      ? a.priceUsdc === 0
                        ? "Free"
                        : `$${(a.priceUsdc / 1_000_000).toFixed(2)} USDC`
                      : "—"}
                  </span>
                  {a.status && <Badge variant="outline">{a.status}</Badge>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
