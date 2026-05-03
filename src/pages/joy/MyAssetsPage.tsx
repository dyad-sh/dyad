/**
 * /joy/my-assets — list everything the user has published.
 *
 * Backed by `joybridge:list-my-assets`. Replaces /my-marketplace-assets
 * (which stays as a deprecation banner per D9).
 */

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IpcClient } from "@/ipc/ipc_client";
import { Package, Plus, Sparkles } from "lucide-react";
import type { Asset, Result } from "@/lib/joybridge_client";

export default function JoyMyAssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const ipc = IpcClient.getInstance();
      const res = (await ipc.invoke("joybridge:list-my-assets")) as Result<
        Asset[]
      >;
      if (res?.ok) setAssets(res.data ?? []);
      else setError(res?.error ?? "Failed to load assets");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Package className="h-8 w-8 text-violet-500" />
            My Assets
          </h1>
          <p className="text-muted-foreground">
            Everything you've published to the Joy Marketplace.
          </p>
        </div>
        <Link to="/joy/publish">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Publish New
          </Button>
        </Link>
      </header>

      {error && (
        <Card>
          <CardContent className="p-4 text-red-600 dark:text-red-400">
            {error}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-muted-foreground">Loading your assets…</div>
      ) : assets.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground space-y-2">
            <p>You haven't published anything yet.</p>
            <p className="text-sm">
              Open any studio (Image, Video, Agent, Model, Document) and click{" "}
              <strong>Publish to Marketplace</strong>, or use the{" "}
              <Link to="/joy/publish" className="underline">
                Publish wizard
              </Link>{" "}
              directly.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {assets.map((a) => (
            <Card key={a.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="truncate">{a.name}</span>
                  <Badge variant="secondary">{a.assetType}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {a.description && (
                  <p className="text-muted-foreground line-clamp-2">
                    {a.description}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {a.priceUsdc != null
                      ? a.priceUsdc === 0
                        ? "Free"
                        : `$${(a.priceUsdc / 1_000_000).toFixed(2)} USDC`
                      : "—"}
                  </span>
                  {a.status && <Badge variant="outline">{a.status}</Badge>}
                </div>
                {a.tokenId && (
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    token: {a.tokenId.slice(0, 18)}…
                  </p>
                )}
                <div className="flex items-center gap-1 pt-2 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  <span>Created {a.createdAt ?? "recently"}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
