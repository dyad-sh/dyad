import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse, readJsonObject } from "@/lib/validation";

const stages = ["lead", "qualified", "proposal", "won", "lost"] as const;
type Context = { params: Promise<{ id: string }> };
type Deal = { id: string; title: string; amount: number; stage: string; contactId: string | null };

function parseAmount(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(amount) && amount >= 0 ? amount : null;
}

export async function GET(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const { id } = await params;
  const [deal] = await sql`
    SELECT d.id, d.title, d.amount, d.stage, d.contact_id AS "contactId", c.name AS "contactName"
    FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id AND c.workspace_id = ${context.activeWorkspace.id}
    WHERE d.id = ${id} AND d.workspace_id = ${context.activeWorkspace.id}`;
  if (!deal) return errorResponse("Not found", 404);
  return Response.json(deal);
}

export async function PATCH(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (!canWriteRecords(context)) return errorResponse("Forbidden", 403);
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (hasForbiddenSuppliedWorkspace(context, request, body)) return errorResponse("Forbidden", 403);
  const { id } = await params;
  const [existing] = await sql`SELECT id, title, amount, stage, contact_id AS "contactId" FROM deals WHERE id = ${id} AND workspace_id = ${context.activeWorkspace.id}` as Deal[];
  if (!existing) return errorResponse("Not found", 404);
  const title = body.title === undefined ? existing.title : body.title;
  const amount = body.amount === undefined ? existing.amount : parseAmount(body.amount);
  const stage = body.stage === undefined ? existing.stage : body.stage;
  if (body.contactId !== undefined && body.contactId !== null && typeof body.contactId !== "string") return errorResponse("Contact is invalid");
  const contactId = body.contactId === undefined ? existing.contactId : (typeof body.contactId === "string" && body.contactId ? body.contactId : null);
  if (typeof title !== "string" || !title.trim()) return errorResponse("Title is required");

  if (amount === null || !Number.isInteger(amount) || amount < 0) return errorResponse("Amount must be a non-negative whole-dollar value");
  if (typeof stage !== "string" || !stages.includes(stage as typeof stages[number])) return errorResponse("Invalid stage");
  if (contactId) {
    const contact = await sql`SELECT id FROM contacts WHERE id = ${contactId} AND workspace_id = ${context.activeWorkspace.id}`;
    if (!contact.length) return errorResponse("Contact not found");
  }
  const [deal] = await sql`
    WITH updated_deal AS (
      UPDATE deals SET title = ${title.trim()}, amount = ${amount}, stage = ${stage}, contact_id = ${contactId}, updated_at = now()
      WHERE id = ${id} AND workspace_id = ${context.activeWorkspace.id}
      RETURNING id, title, amount, stage, contact_id AS "contactId"
    ), recorded_activity AS (
      INSERT INTO contact_activities (workspace_id, contact_id, type, body, actor_user_id, actor_email)
      SELECT ${context.activeWorkspace.id}, ${contactId ?? existing.contactId}, 'deal_stage', left('Deal "' || title || '" moved from ' || ${existing.stage} || ' to ' || stage, 500), ${context.user.id}, ${context.user.email}
      FROM updated_deal WHERE ${contactId ?? existing.contactId} IS NOT NULL AND stage <> ${existing.stage}
    )
    SELECT * FROM updated_deal`;

  return Response.json(deal);
}

export async function DELETE(request: Request, { params }: Context) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (!canWriteRecords(context)) return errorResponse("Forbidden", 403);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const { id } = await params;
  const deleted = await sql`DELETE FROM deals WHERE id = ${id} AND workspace_id = ${context.activeWorkspace.id} RETURNING id`;
  if (!deleted.length) return errorResponse("Not found", 404);
  return new Response(null, { status: 204 });
}
