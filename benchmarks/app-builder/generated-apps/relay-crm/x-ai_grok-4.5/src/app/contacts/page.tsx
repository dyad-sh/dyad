import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/session";
import { canWriteRecords } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { ContactsList } from "@/components/contacts/contacts-list";
import { Button } from "@/components/ui/button";
import type { Contact } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);

  const contacts = (await sql`
    SELECT
      c.id,
      c.name,
      c.email,
      c.phone,
      c.title,
      c.company_id,
      co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co
      ON co.id = c.company_id AND co.workspace_id = c.workspace_id
    WHERE c.workspace_id = ${context.workspaceId}
    ORDER BY c.created_at DESC
  `) as Contact[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="mt-1 text-sm text-slate-500">
            People you work with across your accounts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href="/api/export/contacts.csv" data-testid="export-contacts-button">
              Export CSV
            </a>
          </Button>
          {canWriteRecords(context.role) ? (
            <Button asChild>
              <Link href="/contacts/new" data-testid="contact-new-button">
                New contact
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <ContactsList contacts={contacts} />
    </div>
  );
}
