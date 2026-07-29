import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/session";
import { canWriteRecords } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import type { Company } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);
  const canWrite = canWriteRecords(context.role);

  const companies = (await sql`
    SELECT id, name, domain
    FROM companies
    WHERE workspace_id = ${context.workspaceId}
    ORDER BY created_at DESC
  `) as Company[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="mt-1 text-sm text-slate-500">
            Accounts and organizations in your pipeline.
          </p>
        </div>
        {canWrite ? (
                  <Button asChild>
                    <Link href="/companies/new" data-testid="company-new-button">
                      New company
                    </Link>
                  </Button>
                ) : null}
              </div>

      <div data-testid="companies-list">
        {companies.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
            No companies yet. Create one to link contacts.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {companies.map((company) => (
              <li
                key={company.id}
                data-testid="company-row"
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/companies/${company.id}`}
                    data-testid="company-row-name"
                    className="font-medium text-slate-900 underline-offset-4 hover:underline"
                  >
                    {company.name}
                  </Link>
                  <p className="truncate text-sm text-slate-500">
                    {company.domain || "No domain"}
                  </p>
                </div>
                <Link
                  href={`/companies/${company.id}`}
                  className="text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
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
