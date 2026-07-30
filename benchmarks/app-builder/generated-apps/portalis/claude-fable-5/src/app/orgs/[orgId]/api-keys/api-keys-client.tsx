"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
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
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  status: string;
};

export function ApiKeysClient({
  orgId,
  keys,
}: {
  orgId: string;
  keys: ApiKey[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    const res = await fetch(`/api/orgs/${orgId}/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setCreating(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? "Could not create the key.");
      return;
    }
    setPlaintext(body.key);
    setName("");
    router.refresh();
  };

  const revokeKey = async (keyId: string) => {
    await fetch(`/api/orgs/${orgId}/api-keys/${keyId}`, { method: "DELETE" });
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">API keys</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a key</CardTitle>
          <CardDescription>
            Read-only access to this organization&apos;s projects via{" "}
            <code className="text-xs">GET /api/v1/projects</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={createKey} className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-2">
              <Label htmlFor="apikey-name">Key name</Label>
              <Input
                id="apikey-name"
                data-testid="apikey-name-input"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="CI pipeline"
              />
            </div>
            <Button
              type="submit"
              data-testid="apikey-create-submit"
              disabled={creating}
            >
              {creating ? "Creating…" : "Create key"}
            </Button>
          </form>
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {plaintext && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
                <KeyRound className="h-4 w-4" />
                Copy this key now — it will never be shown again.
              </p>
              <code
                data-testid="apikey-plaintext"
                className="block break-all rounded bg-background px-3 py-2 text-sm"
              >
                {plaintext}
              </code>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {keys.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No API keys yet.
            </p>
          ) : (
            <Table data-testid="apikeys-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow
                    key={key.id}
                    data-testid="apikey-row"
                    data-key-id={key.id}
                  >
                    <TableCell data-testid="apikey-name" className="font-medium">
                      {key.name}
                    </TableCell>
                    <TableCell data-testid="apikey-prefix">
                      <code className="rounded bg-muted px-2 py-1 text-xs">
                        {key.prefix}…
                      </code>
                    </TableCell>
                    <TableCell data-testid="apikey-status">
                      <Badge
                        variant={
                          key.status === "active" ? "secondary" : "outline"
                        }
                      >
                        {key.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {key.status === "active" && (
                        <Button
                          data-testid="apikey-revoke"
                          variant="outline"
                          size="sm"
                          onClick={() => revokeKey(key.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
