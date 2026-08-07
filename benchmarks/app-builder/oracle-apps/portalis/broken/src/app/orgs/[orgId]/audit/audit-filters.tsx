import { AUDIT_ACTIONS } from "@/lib/audit-actions";

/**
 * A plain HTML GET form: submitting it is a real navigation to
 * `/orgs/{orgId}/audit?action=&actor=`, so the filtered result is exactly what
 * the server renders for that URL. No client JavaScript is involved, which
 * also means the filters keep working before (or without) hydration.
 */
export function AuditFilters({
  orgId,
  initialAction,
  initialActor,
}: {
  orgId: string;
  initialAction: string;
  initialActor: string;
}) {
  return (
    <form
      method="get"
      action={`/orgs/${orgId}/audit`}
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="space-y-1.5">
        <label
          htmlFor="filter-action"
          className="block text-sm font-medium text-slate-700"
        >
          Action
        </label>
        <select
          id="filter-action"
          name="action"
          data-testid="audit-filter-action"
          defaultValue={initialAction}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500"
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[14rem] flex-1 space-y-1.5">
        <label
          htmlFor="filter-actor"
          className="block text-sm font-medium text-slate-700"
        >
          Actor email
        </label>
        <input
          id="filter-actor"
          name="actor"
          data-testid="audit-filter-actor"
          type="text"
          defaultValue={initialActor}
          placeholder="admin@company.com"
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-500"
        />
      </div>

      <button
        type="submit"
        data-testid="audit-filter-apply"
        className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
      >
        Apply filters
      </button>
    </form>
  );
}
