import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse, isValidEmail, optionalString, readJsonObject } from "@/lib/validation";

export async function GET(request: Request) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const workspaceId = context.activeWorkspace.id;
  const contacts = await sql`
    SELECT c.id, c.name, c.email, c.phone, c.title, c.company_id AS "companyId", co.name AS "companyName"
    FROM contacts c LEFT JOIN companies co ON co.id = c.company_id AND co.workspace_id = ${workspaceId}
    WHERE c.workspace_id = ${workspaceId} ORDER BY c.created_at DESC`;
  return Response.json(contacts);
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
  if (body.email !== undefined && typeof body.email !== "string") return errorResponse("Email is invalid");
  if (body.phone !== undefined && typeof body.phone !== "string") return errorResponse("Phone must be text");
  if (body.title !== undefined && typeof body.title !== "string") return errorResponse("Title must be text");
  if (body.companyId !== undefined && body.companyId !== null && typeof body.companyId !== "string") return errorResponse("Company is invalid");
  const email = optionalString(body.email).trim();
  if (email && !isValidEmail(email)) return errorResponse("Email is invalid");
  const workspaceId = context.activeWorkspace.id;
  const companyId = typeof body.companyId === "string" && body.companyId ? body.companyId : null;
  if (companyId) {
    const company = await sql`SELECT id FROM companies WHERE id = ${companyId} AND workspace_id = ${workspaceId}`;
    if (!company.length) return errorResponse("Company not found");
  }
  const [contact] = await sql`

    WITH created_contact AS (
      INSERT INTO contacts (workspace_id, created_by_user_id, name, email, phone, title, company_id)
      VALUES (${workspaceId}, ${context.user.id}, ${body.name.trim()}, ${email}, ${optionalString(body.phone)}, ${optionalString(body.title)}, ${companyId})
      RETURNING id, name, email, phone, title, company_id AS "companyId"
    ), recorded_activity AS (
      INSERT INTO contact_activities (workspace_id, contact_id, type, body, actor_user_id, actor_email)
      SELECT ${workspaceId}, id, 'created', 'Contact created', ${context.user.id}, ${context.user.email} FROM created_contact
    )
    SELECT * FROM created_contact`;
  return Response.json(contact, { status: 201 });
}
