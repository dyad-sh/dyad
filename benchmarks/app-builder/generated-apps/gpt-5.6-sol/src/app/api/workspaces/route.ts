import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse, readJsonObject } from "@/lib/validation";

export async function GET(request: Request) {

  const context = await getWorkspaceContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (hasForbiddenSuppliedWorkspace(context, request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json(context.memberships.map((membership) => ({ id: membership.workspaceId, name: membership.workspaceName, membershipId: membership.membershipId, role: membership.role })));
}

export async function POST(request: Request) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (!canWriteRecords(context)) return errorResponse("Forbidden", 403);
  const parsed = await readJsonObject(request);

  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (hasForbiddenSuppliedWorkspace(context, request, body)) return errorResponse("Forbidden", 403);
  if (typeof body.name !== "string" || !body.name.trim()) return errorResponse("Name is required");
  const [workspace] = await sql`

    WITH created_workspace AS (
      INSERT INTO workspaces (name) VALUES (${body.name.trim()}) RETURNING id, name
    ), created_membership AS (
      INSERT INTO workspace_memberships (workspace_id, user_id, email, role)
      SELECT id, ${context.user.id}, ${context.user.email.toLowerCase()}, 'owner' FROM created_workspace
      RETURNING workspace_id
    )
    SELECT w.id, w.name FROM created_workspace w
    JOIN created_membership m ON m.workspace_id = w.id`;
  return Response.json(workspace, { status: 201 });
}
