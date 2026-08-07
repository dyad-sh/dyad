import { NotAuthorized } from "@/components/not-authorized";
import { listAuditEntries } from "@/lib/audit";
import { getOrgForMember, requireUser } from "@/lib/orgs";
import { AuditFilters } from "./audit-filters";

export const dynamic = "force-dynamic";

// ISO-8601 UTC: unambiguous to read and unambiguous to parse.
function formatTimestamp(value: string | Date): string {
  return new Date(value).toISOString();
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ action?: string; actor?: string }>;
}) {
  const { orgId } = await params;
  const { action = "", actor = "" } = await searchParams;

  const user = await requireUser();
  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) return <NotAuthorized />;
  if (membership.role !== "org_admin") return <NotAuthorized />;

  const entries = await listAuditEntries(membership.org.id, { action, actor });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Audit log</h2>
        <p className="mt-1 text-sm text-slate-500">
          Append-only history of administrative changes in{" "}
          {membership.org.name}.
        </p>
      </div>

      <AuditFilters
        orgId={membership.org.id}
        initialAction={action}
        initialActor={actor}
      />

      {entries.length === 0 ? (
        <p
          data-testid="audit-empty"
          className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-sm text-slate-500"
        >
          No audit events match these filters.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table data-testid="audit-table" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3 font-medium">Action</th>
                <th className="px-6 py-3 font-medium">Actor</th>
                <th className="px-6 py-3 font-medium">Target</th>
                <th className="px-6 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  data-testid="audit-row"
                  data-audit-id={entry.id}
                  data-action={entry.action}
                  data-actor-email={entry.actor_email}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-6 py-4">
                    <span
                      data-testid="audit-action"
                      className="inline-flex rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-medium text-slate-700"
                    >
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      data-testid="audit-actor"
                      className="font-medium text-slate-900"
                    >
                      {entry.actor_email}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-600">
                    <span data-testid="audit-target">{entry.target}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      data-testid="audit-timestamp"
                      className="whitespace-nowrap font-mono text-xs text-slate-500"
                    >
                      {formatTimestamp(entry.created_at)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
