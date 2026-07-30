import { redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/session";
import { canWriteRecords } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { ContactForm } from "@/components/contacts/contact-form";
import { ForbiddenMessage } from "@/components/forbidden-message";
import type { Company } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);
  if (!canWriteRecords(context.role)) {
    return (
      <ForbiddenMessage
        title="New contact"
        message="Viewers cannot create contacts."
      />
    );
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
        <h1 className="text-2xl font-semibold tracking-tight">New contact</h1>
        <p className="mt-1 text-sm text-slate-500">Add someone to your CRM.</p>
      </div>
      <ContactForm companies={companies} mode="create" />
    </div>
  );
}
