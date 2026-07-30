import { sql } from "@/db";
import { getWorkspaceMembership, hasForbiddenSuppliedWorkspace, type WorkspaceRole } from "@/lib/workspace";
import { errorResponse, readJsonObject } from "@/lib/validation";

type Context = { params: Promise<{ id: string; memberId: string }> };
type Member = { id: string; userId: string; role: WorkspaceRole };
const roles: WorkspaceRole[] = ["owner", "member", "viewer"];

export async function PATCH(request: Request, { params }: Context) {
  const { id, memberId } = await params;
  const access = await getWorkspaceMembership(id);
  if (access.status !== 200) return errorResponse(access.status === 401 ? "Unauthorized" : "Forbidden", access.status);
  if (access.membership.role !== "owner") return errorResponse("Forbidden", 403);
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (hasForbiddenSuppliedWorkspace(access.context, request, body)) return errorResponse("Forbidden", 403);
  if (typeof body.role !== "string" || !roles.includes(body.role as WorkspaceRole)) return errorResponse("Invalid role");
  const [target] = await sql`SELECT id, user_id AS "userId", role FROM workspace_memberships WHERE id = ${memberId} AND workspace_id = ${id}` as Member[];
  if (!target) return errorResponse("Member not found", 404);
  if (target.userId === access.context.user.id) return errorResponse("You cannot change your own role", 403);
  try {
    const [updated] = await sql`UPDATE workspace_memberships SET role = ${body.role} WHERE id = ${memberId} AND workspace_id = ${id} RETURNING id, user_id AS "userId", email, role`;
    return Response.json(updated);
  } catch {
    return errorResponse("A workspace must keep at least one owner", 403);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const { id, memberId } = await params;
  const access = await getWorkspaceMembership(id);
  if (access.status !== 200) return errorResponse(access.status === 401 ? "Unauthorized" : "Forbidden", access.status);
  if (access.membership.role !== "owner") return errorResponse("Forbidden", 403);
  if (hasForbiddenSuppliedWorkspace(access.context, request)) return errorResponse("Forbidden", 403);
  const [target] = await sql`SELECT id, user_id AS "userId", role FROM workspace_memberships WHERE id = ${memberId} AND workspace_id = ${id}` as Member[];
  if (!target) return errorResponse("Member not found", 404);
  if (target.userId === access.context.user.id) return errorResponse("You cannot remove yourself", 403);
  try {
    await sql`DELETE FROM workspace_memberships WHERE id = ${memberId} AND workspace_id = ${id}`;
    return new Response(null, { status: 204 });
  } catch {
    return errorResponse("A workspace must keep at least one owner", 403);
  }
}
