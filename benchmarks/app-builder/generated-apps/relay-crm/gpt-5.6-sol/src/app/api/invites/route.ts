import { sql } from "@/db";
import { getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";

export async function GET(request: Request) {
  const context = await getWorkspaceContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (hasForbiddenSuppliedWorkspace(context, request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const invites = await sql`
    SELECT i.id, i.email, w.id AS "workspaceId", w.name AS "workspaceName"
    FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id
    WHERE lower(i.email) = ${context.user.email.toLowerCase()} AND i.status = 'pending'
    ORDER BY i.created_at DESC` as { id: string; email: string; workspaceId: string; workspaceName: string }[];
  return Response.json(invites.map((invite) => ({ ...invite, workspace: { id: invite.workspaceId, name: invite.workspaceName } })));
}
