import { Suspense } from "react";
import { NotAuthorized } from "@/components/not-authorized";
import { AuditFilters } from "@/components/orgs/audit-filters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAuditLogs } from "@/lib/audit";
import { requireOrgAccess } from "@/lib/orgs";
import { isOrgAdmin } from "@/lib/roles";

export const dynamic = "force-dynamic";

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toISOString();
  } catch {
    return value;
  }
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ action?: string; actor?: string }>;
}) {
  const { orgId } = await params;
  const filters = await searchParams;
  const access = await requireOrgAccess(orgId);

  if (!access) {
    return <NotAuthorized />;
  }
  if (!isOrgAdmin(access.membership.role)) {
    return <NotAuthorized />;
  }

  const logs = await listAuditLogs(orgId, {
    action: filters.action,
    actor: filters.actor,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Audit log</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Append-only history of administrative actions in this organization.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        }
      >
        <AuditFilters orgId={orgId} />
      </Suspense>

      {logs.length === 0 ? (
        <div
          data-testid="audit-empty"
          className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground"
        >
          No audit events match these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
          <Table data-testid="audit-table">
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow
                  key={log.id}
                  data-testid="audit-row"
                  data-audit-id={log.id}
                  data-action={log.action}
                  data-actor-email={log.actor_email}
                >
                  <TableCell
                    data-testid="audit-timestamp"
                    className="whitespace-nowrap font-mono text-xs text-muted-foreground"
                  >
                    {formatTimestamp(log.created_at)}
                  </TableCell>
                  <TableCell data-testid="audit-actor">
                    {log.actor_email}
                  </TableCell>
                  <TableCell data-testid="audit-action" className="font-mono text-xs">
                    {log.action}
                  </TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">
                    {log.target || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
