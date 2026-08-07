import { AuditFilter } from "@/components/audit-filter";
import { listAudit, parseAuditFilter } from "@/lib/audit";
import { pageContext } from "@/lib/context";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const { action } = await searchParams;
  const ctx = await pageContext();
  const filter = parseAuditFilter(action ?? null);
  const rows = await listAudit(ctx.bookId, filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Audit trail</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every posting, reversal, close and reopen in {ctx.bookName}, newest
          first. Rows are never edited or removed.
        </p>
      </div>

      <AuditFilter action={filter ?? "all"} />

      {rows.length === 0 ? (
        <p
          data-testid="audit-empty"
          className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500"
        >
          Nothing has happened in this book yet.
        </p>
      ) : null}

      <div
        data-testid="audit-list"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <div className="grid grid-cols-[10rem_1fr_1fr_14rem] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Action</span>
          <span>Actor</span>
          <span>Target</span>
          <span>When</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.id}
            data-testid="audit-row"
            data-audit-id={row.id}
            data-audit-action={row.action}
            data-audit-time={row.createdAt}
            className="grid grid-cols-[10rem_1fr_1fr_14rem] gap-4 border-b border-slate-100 px-5 py-3 text-sm last:border-b-0"
          >
            <span data-testid="audit-row-action" className="font-medium text-slate-900">
              {row.action}
            </span>
            <span data-testid="audit-row-actor" className="truncate text-slate-700">
              {row.actorEmail}
            </span>
            <span
              data-testid="audit-row-target"
              className="truncate font-mono text-xs text-slate-600"
            >
              {row.targetId}
            </span>
            <span data-testid="audit-row-time" className="font-mono text-xs text-slate-600">
              {row.createdAt}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
