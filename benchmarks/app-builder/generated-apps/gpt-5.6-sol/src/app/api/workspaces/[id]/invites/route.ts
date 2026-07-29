import { sql } from "@/db";
import { getWorkspaceMembership, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse, isValidEmail, readJsonObject } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const access = await getWorkspaceMembership(id);
  if (access.status !== 200) return errorResponse(access.status === 401 ? "Unauthorized" : "Forbidden", access.status);
  if (access.membership.role !== "owner") return errorResponse("Forbidden", 403);
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (hasForbiddenSuppliedWorkspace(access.context, request, body)) return errorResponse("Forbidden", 403);
  if (typeof body.email !== "string" || !body.email.trim() || !isValidEmail(body.email.trim())) return errorResponse("A valid email is required");
  if (body.role !== "member" && body.role !== "viewer") return errorResponse("Invite role must be member or viewer");
  const email = body.email.trim().toLowerCase();
  const existingMember = await sql`SELECT id FROM workspace_memberships WHERE workspace_id = ${id} AND lower(email) = ${email}`;
  if (existingMember.length) return errorResponse("This person is already a member");
  try {
    const [invite] = await sql`
      INSERT INTO workspace_invites (workspace_id, email, role, invited_by_user_id)
      VALUES (${id}, ${email}, ${body.role}, ${access.context.user.id})
      RETURNING id, email, role`;
    return Response.json({ ...invite, workspaceId: id, workspaceName: access.membership.workspaceName, workspace: { id, name: access.membership.workspaceName } }, { status: 201 });
  } catch {
    return errorResponse("An invite is already pending for this email");
  }
}
