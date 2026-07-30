import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyForm } from "@/components/company-form";
import { DeleteRecord } from "@/components/delete-record";
import { getCompany, listContactsByCompany } from "@/lib/queries";
import { canWrite } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await pageWorkspaceContext();
  const { id } = await params;
  const company = await getCompany(ctx.workspaceId, id);
  if (!company) notFound();
  const contacts = await listContactsByCompany(ctx.workspaceId, company.id);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1
          data-testid="company-detail-name"
          className="text-2xl font-semibold tracking-tight text-slate-900"
        >
          {company.name}
        </h1>
        <p data-testid="company-detail-domain" className="mt-1 text-sm text-slate-500">
          {company.domain ?? ""}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Contacts
        </h2>
        <div
          data-testid="company-contacts-list"
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          {contacts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              No contacts linked to this company.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {contacts.map((c) => (
                <li
                  key={c.id}
                  data-testid="company-contact-row"
                  className="flex items-center gap-4 px-4 py-3 transition hover:bg-slate-50"
                >
                  <span className="text-sm font-medium text-slate-900">
                    {c.name}
                  </span>
                  <span className="text-sm text-slate-500">{c.email ?? ""}</span>
                  <Link
                    href={`/contacts/${c.id}`}
                    className="ml-auto text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
                  >
                    View
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {canWrite(ctx.role) ? (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Edit company
            </h2>
            <CompanyForm company={company} />
          </section>

          <DeleteRecord
            endpoint={`/api/companies/${company.id}`}
            redirectTo="/companies"
            label="company"
            deleteTestId="company-delete-button"
            confirmTestId="company-delete-confirm"
          />
        </>
      ) : null}

      <Link
        href="/companies"
        className="inline-block text-sm text-slate-500 underline-offset-4 hover:underline"
      >
        ← Back to companies
      </Link>
    </div>
  );
}
