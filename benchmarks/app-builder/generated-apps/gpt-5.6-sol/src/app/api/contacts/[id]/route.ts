import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse, isValidEmail, optionalString, readJsonObject } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const { id } = await params;
  const workspaceId = context.activeWorkspace.id;
  const [contact] = await sql`
    SELECT c.id, c.name, c.email, c.phone, c.title, c.company_id AS "companyId", co.name AS "companyName"
    FROM contacts c LEFT JOIN companies co ON co.id = c.company_id AND co.workspace_id = ${workspaceId}
    WHERE c.id = ${id} AND c.workspace_id = ${workspaceId}`;
  if (!contact) return errorResponse("Not found", 404);
  return Response.json(contact);
}

export async function PATCH(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (!canWriteRecords(context)) return errorResponse("Forbidden", 403);
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (hasForbiddenSuppliedWorkspace(context, request, body)) return errorResponse("Forbidden", 403);
  if (typeof body.name !== "string" || !body.name.trim()) return errorResponse("Name is required");
  if (body.email !== undefined && typeof body.email !== "string") return errorResponse("Email is invalid");
  if (body.phone !== undefined && typeof body.phone !== "string") return errorResponse("Phone must be text");
  if (body.title !== undefined && typeof body.title !== "string") return errorResponse("Title must be text");
  if (body.companyId !== undefined && body.companyId !== null && typeof body.companyId !== "string") return errorResponse("Company is invalid");
  const email = optionalString(body.email).trim();
  if (email && !isValidEmail(email)) return errorResponse("Email is invalid");
  const { id } = await params;
  const workspaceId = context.activeWorkspace.id;
  const companyId = typeof body.companyId === "string" && body.companyId ? body.companyId : null;

  if (companyId) {
    const company = await sql`SELECT id FROM companies WHERE id = ${companyId} AND workspace_id = ${workspaceId}`;
    if (!company.length) return errorResponse("Company not found");
  }
  const [contact] = await sql`
    WITH updated_contact AS (
      UPDATE contacts SET name = ${body.name.trim()}, email = ${email}, phone = ${optionalString(body.phone)}, title = ${optionalString(body.title)}, company_id = ${companyId}, updated_at = now()
      WHERE id = ${id} AND workspace_id = ${workspaceId}
      RETURNING id, name, email, phone, title, company_id AS "companyId"
    ), recorded_activity AS (
      INSERT INTO contact_activities (workspace_id, contact_id, type, body, actor_user_id, actor_email)
      SELECT ${workspaceId}, id, 'updated', 'Contact updated', ${context.user.id}, ${context.user.email} FROM updated_contact
    )
    SELECT * FROM updated_contact`;
  if (!contact) return errorResponse("Not found", 404);
  return Response.json(contact);
}

export async function DELETE(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (!canWriteRecords(context)) return errorResponse("Forbidden", 403);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const { id } = await params;
  const deleted = await sql`DELETE FROM contacts WHERE id = ${id} AND workspace_id = ${context.activeWorkspace.id} RETURNING id`;
  if (!deleted.length) return errorResponse("Not found", 404);
  return new Response(null, { status: 204 });
}
