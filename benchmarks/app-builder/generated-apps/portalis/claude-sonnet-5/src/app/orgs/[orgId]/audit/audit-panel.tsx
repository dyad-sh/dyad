"use client";

import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ACTIONS = [
  "org.created",
  "org.updated",
  "member.invited",
  "invite.revoked",
  "invite.accepted",
  "member.role_changed",
  "member.removed",
  "project.created",
  "project.updated",
  "project.deleted",
  "apikey.created",
  "apikey.revoked",
];

interface AuditEntry {
  id: string;
  action: string;
  target: string | null;
  created_at: string;
  actor_email: string;
}

const selectClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function AuditPanel({ orgId }: { orgId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [actorInput, setActorInput] = useState("");

  async function fetchEntries(action: string, actor: string) {
    setLoading(true);
    const searchParams = new URLSearchParams();
    if (action) searchParams.set("action", action);
    if (actor) searchParams.set("actor", actor);

    const res = await fetch(
      `/api/orgs/${orgId}/audit?${searchParams.toString()}`,
    );
    if (res.ok) {
      setEntries(await res.json());
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchEntries("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    fetchEntries(actionFilter, actorInput);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Audit log</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every administrative action taken in this organization.
      </p>

      <form
        onSubmit={handleApply}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
      >
        <div className="space-y-2">
          <Label htmlFor="audit-filter-action">Action</Label>
          <select
            id="audit-filter-action"
            className={selectClassName}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            data-testid="audit-filter-action"
          >
            <option value="">All actions</option>
            {ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="audit-filter-actor">Actor email</Label>
          <Input
            id="audit-filter-actor"
            placeholder="teammate@company.com"
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            data-testid="audit-filter-actor"
          />
        </div>

        <Button type="submit" data-testid="audit-filter-apply">
          Apply filters
        </Button>
      </form>

      <div className="mt-6 rounded-xl border border-border bg-card shadow-sm">
        {!loading && entries.length === 0 ? (
          <p
            className="px-6 py-10 text-center text-sm text-muted-foreground"
            data-testid="audit-empty"
          >
            No audit events match these filters.
          </p>
        ) : (
          <Table data-testid="audit-table">
            <TableHeader>
              <TableRow>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  data-testid="audit-row"
                  data-audit-id={entry.id}
                  data-action={entry.action}
                  data-actor-email={entry.actor_email}
                >
                  <TableCell data-testid="audit-actor">
                    {entry.actor_email}
                  </TableCell>
                  <TableCell data-testid="audit-action">
                    {entry.action}
                  </TableCell>
                  <TableCell>{entry.target ?? "—"}</TableCell>
                  <TableCell data-testid="audit-timestamp">
                    {new Date(entry.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
