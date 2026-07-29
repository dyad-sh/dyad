import { NextResponse } from "next/server";
import { sql } from "@/db";
import { requireWorkspaceContext, requireWorkspaceWriteContext } from "@/lib/auth/require-user";
import { isDealStage } from "@/lib/deals";
import { isValidationError, validateAmount, validateRequiredString } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { context, error } = await requireWorkspaceContext();
  if (error) return error;
  const { id } = await params;

  const rows = await sql`
    SELECT d.id, d.title, d.amount, d.stage,
           d.contact_id AS "contactId", c.name AS "contactName"
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE d.id = ${id} AND d.workspace_id = ${context.workspace.id}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

export async function PATCH(request: Request, { params }: Params) {
  const { context, error } = await requireWorkspaceWriteContext();
  if (error) return error;
  const { id } = await params;
  const body = await request.json();

  const existingRows = await sql`
    SELECT id, title, amount, stage, contact_id AS "contactId"
    FROM deals WHERE id = ${id} AND workspace_id = ${context.workspace.id}
  `;
  if (existingRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const existing = existingRows[0];

  const title =
    body.title !== undefined ? validateRequiredString(body.title, "Title") : (existing.title as string);
  if (isValidationError(title)) return NextResponse.json(title, { status: 400 });

  const amount = body.amount !== undefined ? validateAmount(body.amount) : (existing.amount as number);
  if (isValidationError(amount)) return NextResponse.json(amount, { status: 400 });

  const stage = body.stage !== undefined ? body.stage : existing.stage;
  if (!isDealStage(stage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  const contactId =
    body.contactId !== undefined
      ? typeof body.contactId === "string" && body.contactId
        ? body.contactId
        : null
      : existing.contactId;

  if (contactId) {
    const owned = await sql`SELECT id FROM contacts WHERE id = ${contactId} AND workspace_id = ${context.workspace.id}`;
    if (owned.length === 0) {
      return NextResponse.json({ error: "Invalid contact" }, { status: 400 });
    }
  }

  const [deal] = await sql`
    UPDATE deals
    SET title = ${title}, amount = ${amount}, stage = ${stage}, contact_id = ${contactId}
    WHERE id = ${id} AND workspace_id = ${context.workspace.id}
    RETURNING id, title, amount, stage, contact_id AS "contactId"
  `;

  if (existing.stage !== stage && contactId) {
    await sql`
      INSERT INTO contact_activities (workspace_id, contact_id, type, body, actor_user_id)
      VALUES (${context.workspace.id}, ${contactId}, 'stage_change',
              ${`Deal "${title}" moved from ${existing.stage} to ${stage}`}, ${context.user.id})
    `;
  }

  return NextResponse.json(deal);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { context, error } = await requireWorkspaceWriteContext();
  if (error) return error;
  const { id } = await params;

  const rows = await sql`DELETE FROM deals WHERE id = ${id} AND workspace_id = ${context.workspace.id} RETURNING id`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
