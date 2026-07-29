import { NextResponse } from "next/server";
import { sql } from "@/db";
import { requireWorkspaceContext, requireWorkspaceWriteContext } from "@/lib/auth/require-user";
import { isDealStage } from "@/lib/deals";
import { isValidationError, validateAmount, validateRequiredString } from "@/lib/validation";

export async function GET() {
  const { context, error } = await requireWorkspaceContext();
  if (error) return error;

  const rows = await sql`
    SELECT d.id, d.title, d.amount, d.stage,
           d.contact_id AS "contactId", c.name AS "contactName"
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE d.workspace_id = ${context.workspace.id}
    ORDER BY d.created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const { context, error } = await requireWorkspaceWriteContext();
  if (error) return error;

  const body = await request.json();

  const title = validateRequiredString(body.title, "Title");
  if (isValidationError(title)) return NextResponse.json(title, { status: 400 });

  const amount = validateAmount(body.amount);
  if (isValidationError(amount)) return NextResponse.json(amount, { status: 400 });

  const stage = body.stage;
  if (!isDealStage(stage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  const contactId = typeof body.contactId === "string" && body.contactId ? body.contactId : null;

  if (contactId) {
    const owned = await sql`SELECT id FROM contacts WHERE id = ${contactId} AND workspace_id = ${context.workspace.id}`;
    if (owned.length === 0) {
      return NextResponse.json({ error: "Invalid contact" }, { status: 400 });
    }
  }

  const rows = await sql`
    INSERT INTO deals (workspace_id, title, amount, stage, contact_id, created_by_user_id)
    VALUES (${context.workspace.id}, ${title}, ${amount}, ${stage}, ${contactId}, ${context.user.id})
    RETURNING id, title, amount, stage, contact_id AS "contactId"
  `;
  return NextResponse.json(rows[0]);
}
