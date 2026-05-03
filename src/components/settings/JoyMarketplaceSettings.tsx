/**
 * Joy Marketplace Settings — connect JoyCreate to the JoyMarketplace API.
 *
 * Lets the user enter:
 *   - Joy Marketplace API key (publisher key)
 *   - Optional API base override (default: Supabase Edge Functions root)
 *   - Supabase URL (for direct read-cache)
 *   - Supabase publishable key (`sb_publishable_...`) — RLS-gated, browser-safe
 *
 * Persists via the `joybridge:connect` IPC channel, which writes
 * `joybridge-config.json` in userData.
 *
 * IMPORTANT: nothing key-shaped is hardcoded in this component. The publishable
 * key Terry provided lives only at runtime in user storage / env.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IpcClient } from "@/ipc/ipc_client";
import { ShoppingCart, KeyRound, Save } from "lucide-react";
import { toast } from "sonner";

interface JoyBridgeConfigSnapshot {
  apiBase: string;
  webBase: string;
  connected: boolean;
  supabaseConfigured: boolean;
}

export function JoyMarketplaceSettings() {
  const [snapshot, setSnapshot] = useState<JoyBridgeConfigSnapshot | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseKey, setSupabaseKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh(): Promise<void> {
    try {
      const ipc = IpcClient.getInstance();
      const cfg = (await ipc.invoke(
        "joybridge:get-config",
      )) as JoyBridgeConfigSnapshot;
      setSnapshot(cfg);
      // We never round-trip the secret; the field is intentionally blank.
      // The user can paste a new value to update it.
      setApiBase((prev) => prev || cfg.apiBase);
    } catch (err) {
      console.error("joybridge:get-config failed", err);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const ipc = IpcClient.getInstance();
      const patch: Record<string, string | undefined> = {};
      if (apiKey.trim()) patch.apiKey = apiKey.trim();
      if (apiBase.trim()) patch.apiBase = apiBase.trim();
      if (supabaseUrl.trim()) patch.supabaseUrl = supabaseUrl.trim();
      if (supabaseKey.trim()) patch.supabasePublishableKey = supabaseKey.trim();
      if (Object.keys(patch).length === 0) {
        toast.info("Nothing to save.");
        return;
      }
      await ipc.invoke("joybridge:connect", patch);
      // Clear secret-shaped fields after save so they don't linger in DOM state.
      setApiKey("");
      setSupabaseKey("");
      await refresh();
      toast.success("Joy Marketplace settings saved.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-purple-500" />
          Joy Marketplace
          {snapshot?.connected && (
            <Badge variant="secondary" className="ml-2">
              Connected
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Connect to the JoyMarketplace API for stores, asset publishing, and
          IPFS pinning. Keys are stored on disk only — never committed to the
          repo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="joy-api-key">
            <KeyRound className="h-3 w-3 inline mr-1" />
            Joy Marketplace API key
          </Label>
          <Input
            id="joy-api-key"
            type="password"
            placeholder={
              snapshot?.connected ? "•••••••••• (paste to replace)" : "joy_…"
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="joy-api-base">API base URL (advanced)</Label>
          <Input
            id="joy-api-base"
            placeholder="https://jgsbmnzhvuwiujqbaieo.supabase.co/functions/v1"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Leave blank to use the default Supabase Edge Functions root.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="joy-supabase-url">Supabase URL</Label>
            <Input
              id="joy-supabase-url"
              placeholder="https://<ref>.supabase.co"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="joy-supabase-key">
              Supabase publishable key
            </Label>
            <Input
              id="joy-supabase-key"
              type="password"
              placeholder={
                snapshot?.supabaseConfigured
                  ? "•••••••••• (paste to replace)"
                  : "sb_publishable_…"
              }
              value={supabaseKey}
              onChange={(e) => setSupabaseKey(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            {snapshot
              ? `Active API: ${snapshot.apiBase}`
              : "Loading current config…"}
          </p>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default JoyMarketplaceSettings;
