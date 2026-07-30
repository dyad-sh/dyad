import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext } from "@/lib/workspace";
import { buttonVariants } from "@/components/ui/button";

type Company = { id: string; name: string; domain: string; contactCount: number };

export default async function CompaniesPage() {
  const context = (await getWorkspaceContext())!;
  const workspaceId = context.activeWorkspace.id;
  const companies = await sql`SELECT co.id, co.name, co.domain, count(c.id)::int AS "contactCount" FROM companies co LEFT JOIN contacts c ON c.company_id = co.id AND c.workspace_id = ${workspaceId} WHERE co.workspace_id = ${workspaceId} GROUP BY co.id ORDER BY co.created_at DESC` as Company[];
  return <div><div className="mb-8 flex items-end justify-between gap-4"><div><p className="text-sm font-medium text-indigo-600">Workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Companies</h1><p className="mt-2 text-sm text-slate-500">The organizations behind your relationships.</p></div>{canWriteRecords(context) && <Link href="/companies/new" className={buttonVariants({ className: "bg-indigo-600 hover:bg-indigo-700" })} data-testid="company-new-button"><Plus /> New company</Link>}</div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="companies-list">{companies.map((company) => <Link href={`/companies/${company.id}`} key={company.id} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md" data-testid="company-row"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600"><Building2 className="h-5 w-5" /></div><h2 className="mt-4 font-semibold text-slate-950" data-testid="company-row-name">{company.name}</h2><p className="mt-1 text-sm text-slate-500">{company.domain || "No domain"}</p><p className="mt-4 text-xs font-medium text-slate-400">{company.contactCount} {company.contactCount === 1 ? "contact" : "contacts"}</p></Link>)}{!companies.length && <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-500">No companies yet.</div>}</div></div>;
}
