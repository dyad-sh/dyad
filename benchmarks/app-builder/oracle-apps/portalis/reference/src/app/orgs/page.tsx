import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { listUserOrgs, requireUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function OrgsPage() {
  const user = await requireUser();
  const orgs = await listUserOrgs(user.id);

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Organizations
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Organizations you belong to.
          </p>
        </div>
        {orgs.length > 0 && (
          <Link
            href="/orgs/new"
            data-testid="create-org-link"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            New organization
          </Link>
        )}
      </div>

      {orgs.length === 0 ? (
        <div
          data-testid="orgs-empty-state"
          className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Building2 className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-base font-semibold text-slate-900">
            No organizations yet
          </h2>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            Create your first organization to start inviting members and
            managing settings.
          </p>
          <Link
            href="/orgs/new"
            data-testid="create-org-link"
            className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Create organization
          </Link>
        </div>
      ) : (
        <ul data-testid="org-list" className="mt-8 grid gap-4 sm:grid-cols-2">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link
                href={`/orgs/${org.id}`}
                data-testid="org-card"
                data-org-id={org.id}
                className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
              >
                <span
                  data-testid="org-card-name"
                  className="block text-base font-semibold text-slate-900"
                >
                  {org.name}
                </span>
                <span className="mt-0.5 block text-xs font-medium text-slate-400">
                  /{org.slug}
                </span>
                {org.description && (
                  <span className="mt-2 block text-sm text-slate-500">
                    {org.description}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
