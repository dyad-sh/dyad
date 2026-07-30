import { redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/session";
import { ensureUserWorkspace } from "@/lib/workspace";
import { InvitesList, type InviteItem } from "@/components/invites/invites-list";

export const dynamic = "force-dynamic";

export default async function InvitesPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  await ensureUserWorkspace(user);
  const email = user.email.trim().toLowerCase();

  const rows = await sql`
    SELECT
      i.id,
      i.email,
      i.workspace_id,
      w.name AS workspace_name
    FROM workspace_invites i
    INNER JOIN workspaces w ON w.id = i.workspace_id
    WHERE lower(i.email) = ${email}
      AND i.status = 'pending'
    ORDER BY i.created_at DESC
  `;

  const invites: InviteItem[] = rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    workspaceId: String(row.workspace_id),
    name: String(row.workspace_name),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invites</h1>
        <p className="mt-1 text-sm text-slate-500">
          Accept invitations to join other workspaces.
        </p>
      </div>
      <InvitesList invites={invites} />
    </div>
  );
}
