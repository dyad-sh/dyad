import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, UserRound } from "lucide-react";
import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext } from "@/lib/workspace";
import { CompanyForm } from "@/components/company-form";

type Props = { params: Promise<{ id: string }> };
type Company = { id: string; name: string; domain: string };
type Contact = { id: string; name: string; email: string; title: string };

export default async function CompanyDetailPage({ params }: Props) {
  const context = (await getWorkspaceContext())!;
  const { id } = await params;
  const workspaceId = context.activeWorkspace.id;
  const [company] = await sql`SELECT id, name, domain FROM companies WHERE id = ${id} AND workspace_id = ${workspaceId}` as Company[];
  if (!company) notFound();
  const contacts = await sql`SELECT id, name, email, title FROM contacts WHERE company_id = ${id} AND workspace_id = ${workspaceId} ORDER BY name` as Contact[];
  return <div><Link href="/companies" className="text-sm font-medium text-slate-500 hover:text-slate-900">← Companies</Link><div className={`mt-5 grid gap-6 ${canWriteRecords(context) ? "lg:grid-cols-[1fr_360px]" : ""}`}><section><div className="rounded-xl border border-slate-200 bg-white p-7 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Company</p><h1 className="mt-2 text-3xl font-semibold tracking-tight" data-testid="company-detail-name">{company.name}</h1><p className="mt-2 text-slate-500" data-testid="company-detail-domain">{company.domain || "No domain"}</p></div><div className="mt-6"><h2 className="mb-4 text-lg font-semibold">Contacts</h2><div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="company-contacts-list">{contacts.map((contact) => <Link href={`/contacts/${contact.id}`} key={contact.id} className="flex items-center justify-between gap-4 border-b border-slate-100 p-4 last:border-0 hover:bg-slate-50" data-testid="company-contact-row"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-600"><UserRound className="h-4 w-4" /></div><div><p className="font-medium text-slate-900">{contact.name}</p><p className="text-sm text-slate-500">{contact.title || "No title"}</p></div></div><span className="hidden items-center gap-1.5 text-sm text-slate-500 sm:flex"><Mail className="h-4 w-4" />{contact.email || "—"}</span></Link>)}{!contacts.length && <p className="p-8 text-center text-sm text-slate-500">No contacts linked to this company.</p>}</div></div></section>{canWriteRecords(context) && <aside><h2 className="mb-4 text-lg font-semibold">Company details</h2><CompanyForm company={company} /></aside>}</div></div>;
}
