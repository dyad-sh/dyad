/**
 * /joy/my-stores — manage user's stores + Create Store wizard.
 *
 * Backed by `joybridge:list-my-stores` and `joybridge:create-store`.
 * Per the plan, this replaces the store-management bits of /creator-dashboard.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { IpcClient } from "@/ipc/ipc_client";
import { Plus, Store as StoreIcon, ExternalLink } from "lucide-react";
import type { Store, Result } from "@/lib/joybridge_client";

export default function JoyMyStoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Wizard state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [royaltyPct, setRoyaltyPct] = useState("5");
  const [payoutWallet, setPayoutWallet] = useState("");

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const ipc = IpcClient.getInstance();
      const res = (await ipc.invoke("joybridge:list-my-stores")) as Result<
        Store[]
      >;
      if (res?.ok) setStores(res.data ?? []);
      else setError(res?.error ?? "Failed to load stores");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createStore(): Promise<void> {
    if (!name.trim() || !slug.trim()) {
      setError("Name and slug are required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const ipc = IpcClient.getInstance();
      const res = (await ipc.invoke("joybridge:create-store", {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        description: description.trim() || undefined,
        royaltyBps: Math.round(Number(royaltyPct) * 100),
        payoutWallet: payoutWallet.trim() || undefined,
      })) as Result<Store>;
      if (res?.ok) {
        setOpen(false);
        setName("");
        setSlug("");
        setDescription("");
        setRoyaltyPct("5");
        setPayoutWallet("");
        await load();
      } else {
        setError(res?.error ?? "Create-store failed");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <StoreIcon className="h-8 w-8 text-emerald-500" />
            My Stores
          </h1>
          <p className="text-muted-foreground">
            Storefronts you own on the Joy Marketplace.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Store
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create a new store</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="store-name">Name</Label>
                <Input
                  id="store-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My AI Studio"
                />
              </div>
              <div>
                <Label htmlFor="store-slug">Slug (URL)</Label>
                <Input
                  id="store-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="my-ai-studio"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Lowercase letters, numbers, dashes. Used in your store URL.
                </p>
              </div>
              <div>
                <Label htmlFor="store-desc">Description</Label>
                <Textarea
                  id="store-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this store sells…"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="store-royalty">Royalty %</Label>
                  <Input
                    id="store-royalty"
                    value={royaltyPct}
                    onChange={(e) => setRoyaltyPct(e.target.value)}
                    type="number"
                    min={0}
                    max={50}
                  />
                </div>
                <div>
                  <Label htmlFor="store-wallet">Payout wallet</Label>
                  <Input
                    id="store-wallet"
                    value={payoutWallet}
                    onChange={(e) => setPayoutWallet(e.target.value)}
                    placeholder="0x… (optional)"
                  />
                </div>
              </div>
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button onClick={createStore} disabled={creating}>
                {creating ? "Creating…" : "Create Store"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {error && !open && (
        <Card>
          <CardContent className="p-4 text-red-600 dark:text-red-400">
            {error}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-muted-foreground">Loading stores…</div>
      ) : stores.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground space-y-2">
            <p>You don't have any stores yet.</p>
            <p className="text-sm">
              Click <strong>Create Store</strong> above to set one up. Your
              store will be reachable at <code>joymarketplace.io/store/&lt;slug&gt;</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {stores.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="truncate">{s.name}</span>
                  {s.status && <Badge>{s.status}</Badge>}
                </CardTitle>
                <p className="text-sm text-muted-foreground">/{s.slug}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {s.description && (
                  <p className="text-sm line-clamp-3">{s.description}</p>
                )}
                <div className="flex gap-2">
                  <a
                    href={`https://joymarketplace.io/store/${s.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    View public page <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
