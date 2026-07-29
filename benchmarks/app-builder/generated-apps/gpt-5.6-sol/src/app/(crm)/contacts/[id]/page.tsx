import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, Phone, Briefcase, Building2 } from "lucide-react";
import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext } from "@/lib/workspace";
import { buttonVariants } from "@/components/ui/button";
import { ContactDelete } from "@/components/contact-delete";
import { ActivityTimeline } from "@/components/activity-timeline";

type Props = { params: Promise<{ id: string }> };
type Contact = { id: string; name: string; email: string; phone: string; title: string; companyId: string | null; companyName: string | null };
type Activity = { id: string; type: string; body: string; actor: string; createdAt: string };

export default async function ContactDetailPage({ params }: Props) {
  const context = (await getWorkspaceContext())!;
  const { id } = await params;
  const workspaceId = context.activeWorkspace.id;
  const [contact] = await sql`
    SELECT c.id, c.name, c.email, c.phone, c.title, c.company_id AS "companyId", co.name AS "companyName"
    FROM contacts c LEFT JOIN companies co ON co.id = c.company_id AND co.workspace_id = ${workspaceId}
    WHERE c.id = ${id} AND c.workspace_id = ${workspaceId}` as Contact[];
  if (!contact) notFound();
  const activities = await sql`SELECT id, type, body, actor_email AS actor, created_at::text AS "createdAt" FROM contact_activities WHERE contact_id = ${id} AND workspace_id = ${workspaceId} ORDER BY created_at DESC, id DESC` as Activity[];
  const canEdit = canWriteRecords(context);
  const details = [

    { icon: Mail, label: "Email", value: contact.email, testId: "contact-detail-email" },
    { icon: Phone, label: "Phone", value: contact.phone, testId: "contact-detail-phone" },
    { icon: Briefcase, label: "Title", value: contact.title, testId: "contact-detail-title" },
    { icon: Building2, label: "Company", value: contact.companyName, testId: "contact-detail-company" },
  ];
  return <div className="mx-auto max-w-3xl"><Link href="/contacts" className="text-sm font-medium text-slate-500 hover:text-slate-900">← Contacts</Link><div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-7"><div><div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-xl font-semibold text-indigo-700">{contact.name.charAt(0).toUpperCase()}</div><h1 className="text-3xl font-semibold tracking-tight" data-testid="contact-detail-name">{contact.name}</h1></div>{canEdit && <div className="flex gap-2"><Link href={`/contacts/${contact.id}/edit`} className={buttonVariants({ variant: "outline" })} data-testid="contact-edit-button">Edit</Link><ContactDelete id={contact.id} /></div>}</div><dl className="grid gap-6 p-7 sm:grid-cols-2">{details.map(({ icon: Icon, label, value, testId }) => <div key={label} className="flex gap-3"><Icon className="mt-0.5 h-5 w-5 text-slate-400" /><div><dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</dt><dd className="mt-1 text-slate-800" data-testid={testId}>{value || "—"}</dd></div></div>)}</dl></div><ActivityTimeline contactId={contact.id} initialActivities={activities} canAddNotes={canEdit} /></div>;
}
