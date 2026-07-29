import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse, optionalString, readJsonObject } from "@/lib/validation";

export async function GET(request: Request) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const workspaceId = context.activeWorkspace.id;
  const companies = await sql`
    SELECT co.id, co.name, co.domain, count(c.id)::int AS "contactCount"
    FROM companies co LEFT JOIN contacts c ON c.company_id = co.id AND c.workspace_id = ${workspaceId}
    WHERE co.workspace_id = ${workspaceId} GROUP BY co.id ORDER BY co.created_at DESC`;
  return Response.json(companies);
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
  if (body.domain !== undefined && typeof body.domain !== "string") return errorResponse("Domain must be text");
  const [company] = await sql`

    INSERT INTO companies (workspace_id, created_by_user_id, name, domain)
    VALUES (${context.activeWorkspace.id}, ${context.user.id}, ${body.name.trim()}, ${optionalString(body.domain)})
    RETURNING id, name, domain`;
  return Response.json(company, { status: 201 });
}
