import { sql } from "@/db";
import { requireSessionUser } from "@/lib/auth/session";
import { ensureUserWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

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

  return Response.json(
    rows.map((row) => ({
      id: String(row.id),
      email: String(row.email),
      // Workspace identity on the invite payload
      workspaceId: String(row.workspace_id),
      name: String(row.workspace_name),
      workspaceName: String(row.workspace_name),
      workspace: {
        id: String(row.workspace_id),
        name: String(row.workspace_name),
      },
    })),
  );
}
