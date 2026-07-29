import { NextResponse } from "next/server";
import { sql } from "@/db";
import { requireWorkspaceContext, requireWorkspaceWriteContext } from "@/lib/auth/require-user";
import { isValidationError, validateEmail, validateOptionalString, validateRequiredString } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { context, error } = await requireWorkspaceContext();
  if (error) return error;
  const { id } = await params;

  const rows = await sql`
    SELECT c.id, c.name, c.email, c.phone, c.title,
           c.company_id AS "companyId", co.name AS "companyName"
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    WHERE c.id = ${id} AND c.workspace_id = ${context.workspace.id}
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
    SELECT id, name, email, phone, title, company_id AS "companyId"
    FROM contacts WHERE id = ${id} AND workspace_id = ${context.workspace.id}
  `;
  if (existingRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const existing = existingRows[0];

  const name = validateRequiredString(body.name, "Name");
  if (isValidationError(name)) return NextResponse.json(name, { status: 400 });

  const email = validateEmail(body.email);
  if (isValidationError(email)) return NextResponse.json(email, { status: 400 });

  const phone = validateOptionalString(body.phone, "Phone");
  if (isValidationError(phone)) return NextResponse.json(phone, { status: 400 });

  const title = validateOptionalString(body.title, "Title");
  if (isValidationError(title)) return NextResponse.json(title, { status: 400 });

  const companyId = typeof body.companyId === "string" && body.companyId ? body.companyId : null;

  if (companyId) {
    const owned = await sql`SELECT id FROM companies WHERE id = ${companyId} AND workspace_id = ${context.workspace.id}`;
    if (owned.length === 0) {
      return NextResponse.json({ error: "Invalid company" }, { status: 400 });
    }
  }

  const changedFields: string[] = [];
  if (existing.name !== name) changedFields.push("name");
  if (existing.email !== email) changedFields.push("email");
  if ((existing.phone ?? null) !== phone) changedFields.push("phone");
  if ((existing.title ?? null) !== title) changedFields.push("title");
  if ((existing.companyId ?? null) !== companyId) changedFields.push("company");

  const [contact] = await sql`
    UPDATE contacts
    SET name = ${name}, email = ${email}, phone = ${phone}, title = ${title}, company_id = ${companyId}
    WHERE id = ${id} AND workspace_id = ${context.workspace.id}
    RETURNING id, name, email, phone, title, company_id AS "companyId"
  `;

  if (changedFields.length > 0) {
    await sql`
      INSERT INTO contact_activities (workspace_id, contact_id, type, body, actor_user_id)
      VALUES (${context.workspace.id}, ${id}, 'updated', ${`Contact updated: ${changedFields.join(", ")}`}, ${context.user.id})
    `;
  }

  return NextResponse.json(contact);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { context, error } = await requireWorkspaceWriteContext();
  if (error) return error;
  const { id } = await params;

  const rows = await sql`DELETE FROM contacts WHERE id = ${id} AND workspace_id = ${context.workspace.id} RETURNING id`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
