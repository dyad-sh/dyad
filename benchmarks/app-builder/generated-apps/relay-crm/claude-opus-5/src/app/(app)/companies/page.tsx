import Link from "next/link";
import { listCompanies } from "@/lib/queries";
import { canWrite } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const ctx = await pageWorkspaceContext();
  const companies = await listCompanies(ctx.workspaceId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Companies
        </h1>
        {canWrite(ctx.role) ? (
          <Link
            href="/companies/new"
            data-testid="company-new-button"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            New company
          </Link>
        ) : null}
      </div>

      <div
        data-testid="companies-list"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        {companies.length === 0 ? (
          <p
            data-testid="companies-empty"
            className="px-4 py-10 text-center text-sm text-slate-500"
          >
            No companies yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {companies.map((c) => (
              <li
                key={c.id}
                data-testid="company-row"
                className="flex items-center gap-6 px-4 py-3 transition hover:bg-slate-50"
              >
                <span
                  data-testid="company-row-name"
                  className="text-sm font-medium text-slate-900"
                >
                  {c.name}
                </span>
                <span className="text-sm text-slate-500">{c.domain ?? ""}</span>
                <Link
                  href={`/companies/${c.id}`}
                  data-testid="company-row-link"
                  className="ml-auto text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
                >
                  View
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
