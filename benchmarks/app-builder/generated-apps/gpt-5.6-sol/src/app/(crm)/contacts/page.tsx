import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext } from "@/lib/workspace";
import { ContactsList } from "@/components/contacts-list";
import { buttonVariants } from "@/components/ui/button";

type Contact = { id: string; name: string; email: string; companyName: string | null };

export default async function ContactsPage() {
  const context = (await getWorkspaceContext())!;
  const workspaceId = context.activeWorkspace.id;
  const contacts = await sql`
    SELECT c.id, c.name, c.email, co.name AS "companyName"
    FROM contacts c LEFT JOIN companies co ON co.id = c.company_id AND co.workspace_id = ${workspaceId}
    WHERE c.workspace_id = ${workspaceId} ORDER BY c.created_at DESC` as Contact[];
  return <div><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-indigo-600">Workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Contacts</h1><p className="mt-2 text-sm text-slate-500">Keep every important relationship close at hand.</p></div><div className="flex gap-2"><Link href="/api/export/contacts.csv" className={buttonVariants({ variant: "outline" })} data-testid="export-contacts-button"><Download /> Export CSV</Link>{canWriteRecords(context) && <Link href="/contacts/new" className={buttonVariants({ className: "bg-indigo-600 hover:bg-indigo-700" })} data-testid="contact-new-button"><Plus /> New contact</Link>}</div></div><ContactsList contacts={contacts} /></div>;
}
