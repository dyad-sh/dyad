import { sql } from "@/db";
import { getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const { id } = await params;
  const [accepted] = await sql`
    WITH accepted_invite AS (
      UPDATE workspace_invites SET status = 'accepted', accepted_at = now()
      WHERE id = ${id} AND lower(email) = ${context.user.email.toLowerCase()} AND status = 'pending'
      RETURNING id, workspace_id, email, role
    ), accepted_membership AS (
      INSERT INTO workspace_memberships (workspace_id, user_id, email, role)
      SELECT workspace_id, ${context.user.id}, ${context.user.email.toLowerCase()}, role
      FROM accepted_invite
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET email = EXCLUDED.email
      RETURNING id, workspace_id
    )
    SELECT i.id, i.email, i.role, w.id AS "workspaceId", w.name AS "workspaceName", m.id AS "membershipId"
    FROM accepted_invite i JOIN accepted_membership m ON m.workspace_id = i.workspace_id
    JOIN workspaces w ON w.id = i.workspace_id`;
  if (!accepted) return errorResponse("Invite not found or not available to this account", 403);
  return Response.json({ ...accepted, workspace: { id: accepted.workspaceId, name: accepted.workspaceName } });
}
