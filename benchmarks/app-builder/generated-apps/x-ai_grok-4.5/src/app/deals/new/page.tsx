import { redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/session";
import { canWriteRecords } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { DealForm } from "@/components/deals/deal-form";
import { ForbiddenMessage } from "@/components/forbidden-message";
import type { Contact } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewDealPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);
  if (!canWriteRecords(context.role)) {
    return (
      <ForbiddenMessage
        title="New deal"
        message="Viewers cannot create deals."
      />
    );
  }

  const contacts = (await sql`
    SELECT id, name, email, phone, title, company_id
    FROM contacts
    WHERE workspace_id = ${context.workspaceId}
    ORDER BY name ASC
  `) as Contact[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New deal</h1>
        <p className="mt-1 text-sm text-slate-500">Add a deal to your pipeline.</p>
      </div>
      <DealForm contacts={contacts} mode="create" />
    </div>
  );
}
