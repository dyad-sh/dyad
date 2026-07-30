import Link from "next/link";
import { ContactsTable } from "@/components/contacts-table";
import { listContacts } from "@/lib/queries";
import { canWrite } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const ctx = await pageWorkspaceContext();
  const contacts = await listContacts(ctx.workspaceId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Contacts
        </h1>
        <div className="flex items-center gap-2">
          <a
            href="/api/export/contacts.csv"
            data-testid="export-contacts-button"
            download="contacts.csv"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Export CSV
          </a>
          {canWrite(ctx.role) ? (
            <Link
              href="/contacts/new"
              data-testid="contact-new-button"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              New contact
            </Link>
          ) : null}
        </div>
      </div>
      <ContactsTable contacts={contacts} />
    </div>
  );
}
