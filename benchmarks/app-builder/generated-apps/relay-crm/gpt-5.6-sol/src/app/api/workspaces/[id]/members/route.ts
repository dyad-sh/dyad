import { sql } from "@/db";
import { getWorkspaceMembership, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const access = await getWorkspaceMembership(id);
  if (access.status !== 200) return errorResponse(access.status === 401 ? "Unauthorized" : "Forbidden", access.status);
  if (access.membership.role !== "owner") return errorResponse("Forbidden", 403);
  if (hasForbiddenSuppliedWorkspace(access.context, request)) return errorResponse("Forbidden", 403);
  const members = await sql`
    SELECT id, user_id AS "userId", email, role
    FROM workspace_memberships WHERE workspace_id = ${id} ORDER BY created_at`;
  return Response.json(members);
}
