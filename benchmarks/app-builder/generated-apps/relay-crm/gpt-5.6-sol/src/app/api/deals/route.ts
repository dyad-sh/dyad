import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse, readJsonObject } from "@/lib/validation";

const stages = ["lead", "qualified", "proposal", "won", "lost"] as const;

function parseAmount(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(amount) && amount >= 0 ? amount : null;
}

export async function GET(request: Request) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const deals = await sql`
    SELECT d.id, d.title, d.amount, d.stage, d.contact_id AS "contactId", c.name AS "contactName"
    FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id AND c.workspace_id = ${context.activeWorkspace.id}
    WHERE d.workspace_id = ${context.activeWorkspace.id} ORDER BY d.created_at DESC`;
  return Response.json(deals);
}

export async function POST(request: Request) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (!canWriteRecords(context)) return errorResponse("Forbidden", 403);
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;
  if (hasForbiddenSuppliedWorkspace(context, request, body)) return errorResponse("Forbidden", 403);
  const amount = parseAmount(body.amount);
  if (typeof body.title !== "string" || !body.title.trim()) return errorResponse("Title is required");
  if (amount === null) return errorResponse("Amount must be a non-negative whole-dollar value");
  if (typeof body.stage !== "string" || !stages.includes(body.stage as typeof stages[number])) return errorResponse("Invalid stage");
  if (body.contactId !== undefined && body.contactId !== null && typeof body.contactId !== "string") return errorResponse("Contact is invalid");
  const contactId = typeof body.contactId === "string" && body.contactId ? body.contactId : null;
  if (contactId) {

    const contact = await sql`SELECT id FROM contacts WHERE id = ${contactId} AND workspace_id = ${context.activeWorkspace.id}`;
    if (!contact.length) return errorResponse("Contact not found");
  }
  const [deal] = await sql`
    INSERT INTO deals (workspace_id, created_by_user_id, title, amount, stage, contact_id)
    VALUES (${context.activeWorkspace.id}, ${context.user.id}, ${body.title.trim()}, ${amount}, ${body.stage}, ${contactId})
    RETURNING id, title, amount, stage, contact_id AS "contactId"`;
  return Response.json(deal, { status: 201 });
}
