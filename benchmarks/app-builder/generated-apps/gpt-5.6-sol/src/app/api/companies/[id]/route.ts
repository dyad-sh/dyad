import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse, optionalString, readJsonObject } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const { id } = await params;
  const workspaceId = context.activeWorkspace.id;
  const [company] = await sql`SELECT id, name, domain FROM companies WHERE id = ${id} AND workspace_id = ${workspaceId}`;
  if (!company) return errorResponse("Not found", 404);
  const contacts = await sql`SELECT id, name, email, phone, title FROM contacts WHERE company_id = ${id} AND workspace_id = ${workspaceId} ORDER BY name`;
  return Response.json({ ...company, contacts });
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
  if (body.domain !== undefined && typeof body.domain !== "string") return errorResponse("Domain must be text");
  const { id } = await params;

  const [company] = await sql`
    UPDATE companies SET name = ${body.name.trim()}, domain = ${optionalString(body.domain)}, updated_at = now()
    WHERE id = ${id} AND workspace_id = ${context.activeWorkspace.id} RETURNING id, name, domain`;
  if (!company) return errorResponse("Not found", 404);
  return Response.json(company);
}

export async function DELETE(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (!canWriteRecords(context)) return errorResponse("Forbidden", 403);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const { id } = await params;
  const deleted = await sql`DELETE FROM companies WHERE id = ${id} AND workspace_id = ${context.activeWorkspace.id} RETURNING id`;
  if (!deleted.length) return errorResponse("Not found", 404);
  return new Response(null, { status: 204 });
}
