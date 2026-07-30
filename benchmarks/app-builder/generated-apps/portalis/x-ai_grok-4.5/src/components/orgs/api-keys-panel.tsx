"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  status: string;
};

type Props = {
  orgId: string;
  keys: ApiKeyRow[];
};

export function ApiKeysPanel({ orgId, keys }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPlaintext(null);
    setPending(true);

    try {
      const res = await fetch(`/api/orgs/${orgId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        key?: string;
      };
      if (!res.ok || !data.key) {
        setError(data.error ?? "Failed to create API key");
        setPending(false);
        return;
      }
      setPlaintext(data.key);
      setName("");
      setPending(false);
      router.refresh();
    } catch {
      setError("Failed to create API key");
      setPending(false);
    }
  }

  async function onRevoke(keyId: string) {
    setRevoking(keyId);
    try {
      await fetch(`/api/orgs/${orgId}/api-keys/${keyId}`, {
        method: "DELETE",
      });
      router.refresh();
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={onCreate}
        className="grid gap-4 rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <div className="space-y-2">
          <Label htmlFor="apikey-name">Key name</Label>
          <Input
            id="apikey-name"
            data-testid="apikey-name-input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production server"
            className="h-10"
          />
        </div>
        <Button type="submit" data-testid="apikey-create-submit" disabled={pending}>
          {pending ? "Creating…" : "Create API key"}
        </Button>
        {error ? (
          <p className="text-sm text-destructive sm:col-span-2" role="alert">
            {error}
          </p>
        ) : null}
        {plaintext ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 sm:col-span-2">
            <p className="mb-1 font-medium">
              Copy this key now. It won&apos;t be shown again.
            </p>
            <code
              data-testid="apikey-plaintext"
              className="break-all font-mono text-xs"
            >
              {plaintext}
            </code>
          </div>
        ) : null}
      </form>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
        <Table data-testid="apikeys-table">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No API keys yet.
                </TableCell>
              </TableRow>
            ) : (
              keys.map((key) => (
                <TableRow
                  key={key.id}
                  data-testid="apikey-row"
                  data-key-id={key.id}
                >
                  <TableCell data-testid="apikey-name" className="font-medium">
                    {key.name}
                  </TableCell>
                  <TableCell
                    data-testid="apikey-prefix"
                    className="font-mono text-xs"
                  >
                    {key.prefix}
                  </TableCell>
                  <TableCell data-testid="apikey-status">{key.status}</TableCell>
                  <TableCell>
                    {key.status === "active" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="apikey-revoke"
                        disabled={revoking === key.id}
                        onClick={() => onRevoke(key.id)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
