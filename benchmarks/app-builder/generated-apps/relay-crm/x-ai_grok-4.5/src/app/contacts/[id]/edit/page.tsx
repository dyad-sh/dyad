import { notFound, redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/session";
import { canWriteRecords } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { ContactForm } from "@/components/contacts/contact-form";
import { ForbiddenMessage } from "@/components/forbidden-message";
import type { Company, Contact } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditContactPage({ params }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);
  if (!canWriteRecords(context.role)) {
    return (
      <ForbiddenMessage
        title="Edit contact"
        message="Viewers cannot edit contacts."
      />
    );
  }

  const { id } = await params;

  const rows = (await sql`
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
    WHERE c.id = ${id} AND c.workspace_id = ${context.workspaceId}
    LIMIT 1
  `) as Contact[];

  if (rows.length === 0) {
    notFound();
  }

  const companies = (await sql`
    SELECT id, name, domain
    FROM companies
    WHERE workspace_id = ${context.workspaceId}
    ORDER BY name ASC
  `) as Company[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit contact</h1>
        <p className="mt-1 text-sm text-slate-500">Update contact details.</p>
      </div>
      <ContactForm companies={companies} contact={rows[0]} mode="edit" />
    </div>
  );
}
