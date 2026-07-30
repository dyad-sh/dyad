"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

type AuditEntry = {
  id: string;
  actorEmail: string;
  action: string;
  target: string;
  createdAt: string;
};

export function AuditClient({ orgId }: { orgId: string }) {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  const load = useCallback(
    async (actionFilter: string, actorFilter: string) => {
      const query = new URLSearchParams();
      if (actionFilter) query.set("action", actionFilter);
      if (actorFilter) query.set("actor", actorFilter);
      const res = await fetch(`/api/orgs/${orgId}/audit?${query.toString()}`);
      if (res.ok) {
        setEntries(await res.json());
      } else {
        setEntries([]);
      }
    },
    [orgId],
  );

  useEffect(() => {
    load("", "");
  }, [load]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Audit log</h2>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          load(action, actor);
        }}
      >
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="audit-action">
            Action
          </label>
          <br />
          <select
            id="audit-action"
            data-testid="audit-filter-action"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="audit-actor">
            Actor email
          </label>
          <Input
            id="audit-actor"
            data-testid="audit-filter-actor"
            className="w-64"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="someone@company.com"
          />
        </div>
        <Button type="submit" data-testid="audit-filter-apply">
          Apply
        </Button>
      </form>

      <Card>
        <CardContent className="p-0">
          {entries !== null && entries.length === 0 ? (
            <p
              data-testid="audit-empty"
              className="px-6 py-10 text-center text-sm text-muted-foreground"
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
                {(entries ?? []).map((entry) => (
                  <TableRow
                    key={entry.id}
                    data-testid="audit-row"
                    data-audit-id={entry.id}
                    data-action={entry.action}
                    data-actor-email={entry.actorEmail}
                  >
                    <TableCell data-testid="audit-actor">
                      {entry.actorEmail}
                    </TableCell>
                    <TableCell data-testid="audit-action">
                      <Badge variant="outline">{entry.action}</Badge>
                    </TableCell>
                    <TableCell className="max-w-64 truncate">
                      {entry.target}
                    </TableCell>
                    <TableCell
                      data-testid="audit-timestamp"
                      className="whitespace-nowrap text-muted-foreground"
                    >
                      {new Date(entry.createdAt).toLocaleString()}
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
