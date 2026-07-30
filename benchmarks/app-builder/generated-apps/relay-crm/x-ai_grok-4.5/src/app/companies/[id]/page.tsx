import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/session";
import { canWriteRecords } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { CompanyDetailClient } from "@/components/companies/company-detail-client";
import type { Company, Contact } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function CompanyDetailPage({ params }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);
  const { id } = await params;

  const companies = (await sql`
    SELECT id, name, domain
    FROM companies
    WHERE id = ${id} AND workspace_id = ${context.workspaceId}
    LIMIT 1
  `) as Company[];

  if (companies.length === 0) {
    notFound();
  }

  const company = companies[0];

  const contacts = (await sql`
    SELECT id, name, email, phone, title, company_id
    FROM contacts
    WHERE workspace_id = ${context.workspaceId} AND company_id = ${company.id}
    ORDER BY name ASC
  `) as Contact[];

  return (
      <div className="space-y-8">
        <CompanyDetailClient
          company={company}
          canWrite={canWriteRecords(context.role)}
        />

      <section className="space-y-3">
        <h2 className="text-lg font-medium tracking-tight">Contacts</h2>
        {contacts.length === 0 ? (
          <div
            data-testid="company-contacts-list"
            className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500"
          >
            No contacts linked to this company yet.
          </div>
        ) : (
          <ul
            data-testid="company-contacts-list"
            className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white"
          >
            {contacts.map((contact) => (
              <li
                key={contact.id}
                data-testid="company-contact-row"
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{contact.name}</p>
                  <p className="truncate text-sm text-slate-500">
                    {contact.email || contact.title || "—"}
                  </p>
                </div>
                <Link
                  href={`/contacts/${contact.id}`}
                  className="text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
                >
                  View
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
