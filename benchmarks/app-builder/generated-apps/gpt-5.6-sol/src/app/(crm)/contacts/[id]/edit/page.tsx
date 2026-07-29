import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext } from "@/lib/workspace";
import { ContactForm } from "@/components/contact-form";

type Props = { params: Promise<{ id: string }> };
type Contact = { id: string; name: string; email: string; phone: string; title: string; companyId: string };
type Company = { id: string; name: string };

export default async function EditContactPage({ params }: Props) {
  const context = (await getWorkspaceContext())!;
  if (!canWriteRecords(context)) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-900" data-testid="forbidden-message">You have read-only access to this workspace.</div>;
  const { id } = await params;
  const workspaceId = context.activeWorkspace.id;
  const [contact] = await sql`SELECT id, name, email, phone, title, coalesce(company_id::text, '') AS "companyId" FROM contacts WHERE id = ${id} AND workspace_id = ${workspaceId}` as Contact[];
  if (!contact) notFound();
  const companies = await sql`SELECT id, name FROM companies WHERE workspace_id = ${workspaceId} ORDER BY name` as Company[];
  return <div className="mx-auto max-w-2xl"><Link href={`/contacts/${id}`} className="text-sm font-medium text-slate-500 hover:text-slate-900">← Contact</Link><h1 className="mb-6 mt-4 text-3xl font-semibold tracking-tight">Edit contact</h1><ContactForm contact={contact} companies={companies} /></div>;
}
