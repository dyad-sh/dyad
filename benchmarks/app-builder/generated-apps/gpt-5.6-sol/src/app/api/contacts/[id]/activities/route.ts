import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse, readJsonObject } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const { id } = await params;
  const contact = await sql`SELECT id FROM contacts WHERE id = ${id} AND workspace_id = ${context.activeWorkspace.id}`;
  if (!contact.length) return errorResponse("Not found", 404);
  const activities = await sql`
    SELECT id, type, body, actor_user_id AS "actorUserId", actor_email AS actor, created_at::text AS "createdAt"
    FROM contact_activities
    WHERE contact_id = ${id} AND workspace_id = ${context.activeWorkspace.id}
    ORDER BY created_at DESC, id DESC`;

  return Response.json(activities);
}

export async function POST(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (!canWriteRecords(context)) return errorResponse("Forbidden", 403);
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (hasForbiddenSuppliedWorkspace(context, request, body)) return errorResponse("Forbidden", 403);
  if (typeof body.body !== "string" || !body.body.trim()) return errorResponse("Note is required");
  const { id } = await params;
  const contact = await sql`SELECT id FROM contacts WHERE id = ${id} AND workspace_id = ${context.activeWorkspace.id}`;
  if (!contact.length) return errorResponse("Not found", 404);
  const [activity] = await sql`
    INSERT INTO contact_activities (workspace_id, contact_id, type, body, actor_user_id, actor_email)
    VALUES (${context.activeWorkspace.id}, ${id}, 'note', ${body.body.trim()}, ${context.user.id}, ${context.user.email})
    RETURNING id, type, body, actor_user_id AS "actorUserId", actor_email AS actor, created_at::text AS "createdAt"`;
  return Response.json(activity, { status: 201 });

}
