import { NextResponse } from "next/server";
import { sql } from "@/db";
import { requireWorkspaceContext, requireWorkspaceWriteContext } from "@/lib/auth/require-user";
import { isValidationError, validateOptionalString, validateRequiredString } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { context, error } = await requireWorkspaceContext();
  if (error) return error;
  const { id } = await params;

  const rows = await sql`
    SELECT id, name, domain FROM companies WHERE id = ${id} AND workspace_id = ${context.workspace.id}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contacts = await sql`
    SELECT id, name, email, phone, title
    FROM contacts
    WHERE company_id = ${id} AND workspace_id = ${context.workspace.id}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ ...rows[0], contacts });
}

export async function PATCH(request: Request, { params }: Params) {
  const { context, error } = await requireWorkspaceWriteContext();
  if (error) return error;
  const { id } = await params;
  const body = await request.json();

  const existing = await sql`SELECT id FROM companies WHERE id = ${id} AND workspace_id = ${context.workspace.id}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const name = validateRequiredString(body.name, "Name");
  if (isValidationError(name)) return NextResponse.json(name, { status: 400 });

  const domain = validateOptionalString(body.domain, "Domain");
  if (isValidationError(domain)) return NextResponse.json(domain, { status: 400 });

  const rows = await sql`
    UPDATE companies
    SET name = ${name}, domain = ${domain}
    WHERE id = ${id} AND workspace_id = ${context.workspace.id}
    RETURNING id, name, domain
  `;
  return NextResponse.json(rows[0]);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { context, error } = await requireWorkspaceWriteContext();
  if (error) return error;
  const { id } = await params;

  const rows = await sql`DELETE FROM companies WHERE id = ${id} AND workspace_id = ${context.workspace.id} RETURNING id`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
