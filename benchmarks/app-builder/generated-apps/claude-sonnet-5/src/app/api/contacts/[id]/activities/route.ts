import { NextResponse } from "next/server";
import { sql } from "@/db";
import { requireWorkspaceContext, requireWorkspaceWriteContext } from "@/lib/auth/require-user";
import { isValidationError, validateRequiredString } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { context, error } = await requireWorkspaceContext();
  if (error) return error;
  const { id } = await params;

  const contactRows = await sql`SELECT id FROM contacts WHERE id = ${id} AND workspace_id = ${context.workspace.id}`;
  if (contactRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await sql`
    SELECT ca.id, ca.type, ca.body, ca.actor_user_id AS "actorUserId",
           u.email AS "actorEmail", ca.created_at AS "createdAt"
    FROM contact_activities ca
    LEFT JOIN neon_auth."user" u ON u.id = ca.actor_user_id
    WHERE ca.contact_id = ${id} AND ca.workspace_id = ${context.workspace.id}
    ORDER BY ca.created_at DESC
  `;

  return NextResponse.json(rows);
}

export async function POST(request: Request, { params }: Params) {
  const { context, error } = await requireWorkspaceWriteContext();
  if (error) return error;
  const { id } = await params;

  const contactRows = await sql`SELECT id FROM contacts WHERE id = ${id} AND workspace_id = ${context.workspace.id}`;
  if (contactRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const noteBody = validateRequiredString(body.body, "Note");
  if (isValidationError(noteBody)) return NextResponse.json(noteBody, { status: 400 });

  const [activity] = await sql`
    INSERT INTO contact_activities (workspace_id, contact_id, type, body, actor_user_id)
    VALUES (${context.workspace.id}, ${id}, 'note', ${noteBody}, ${context.user.id})
    RETURNING id, type, body, actor_user_id AS "actorUserId", created_at AS "createdAt"
  `;

  return NextResponse.json({ ...activity, actorEmail: context.user.email });
}
