"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  status: "active" | "revoked";
  created_at: string;
  revoked_at: string | null;
}

function CreateKeyForm({
  orgId,
  onCreated,
}: {
  orgId: string;
  onCreated: (secret: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Could not create API key.");
      }
      setName("");
      onCreated(data.key as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create API key.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <Label htmlFor="apikey-name">Key name</Label>
        <Input
          id="apikey-name"
          required
          placeholder="Production integration"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="apikey-name-input"
        />
      </div>

      <Button type="submit" disabled={submitting} data-testid="apikey-create-submit">
        {submitting ? "Creating..." : "Create API key"}
      </Button>

      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}

function KeyRow({
  orgId,
  apiKey,
  onChanged,
}: {
  orgId: string;
  apiKey: ApiKey;
  onChanged: () => void;
}) {
  const [revoking, setRevoking] = useState(false);

  async function handleRevoke() {
    setRevoking(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/api-keys/${apiKey.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onChanged();
      }
    } finally {
      setRevoking(false);
    }
  }

  return (
    <TableRow data-testid="apikey-row" data-key-id={apiKey.id}>
      <TableCell data-testid="apikey-name">{apiKey.name}</TableCell>
      <TableCell data-testid="apikey-prefix" className="font-mono text-xs">
        {apiKey.prefix}…
      </TableCell>
      <TableCell data-testid="apikey-status">
        <Badge variant={apiKey.status === "active" ? "default" : "secondary"}>
          {apiKey.status === "active" ? "Active" : "Revoked"}
        </Badge>
      </TableCell>
      <TableCell>
        {apiKey.status === "active" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={revoking}
            onClick={handleRevoke}
            data-testid="apikey-revoke"
          >
            Revoke
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

export function ApiKeysPanel({
  orgId,
  initialKeys,
}: {
  orgId: string;
  initialKeys: ApiKey[];
}) {
  const router = useRouter();
  const [plaintext, setPlaintext] = useState<string | null>(null);

  function handleCreated(secret: string) {
    setPlaintext(secret);
    router.refresh();
  }

  function handleChanged() {
    router.refresh();
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">API keys</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Read-only credentials scoped to this organization. Use them with the{" "}
        <code className="text-xs">GET /api/v1/projects</code> endpoint.
      </p>

      <div className="mt-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <CreateKeyForm orgId={orgId} onCreated={handleCreated} />
      </div>

      {plaintext && (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">
            Copy this key now — you won&apos;t be able to see it again.
          </p>
          <code
            className="mt-2 block break-all rounded-md bg-white px-3 py-2 font-mono text-xs"
            data-testid="apikey-plaintext"
          >
            {plaintext}
          </code>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-border bg-card shadow-sm">
        <Table data-testid="apikeys-table">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialKeys.map((apiKey) => (
              <KeyRow
                key={apiKey.id}
                orgId={orgId}
                apiKey={apiKey}
                onChanged={handleChanged}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
