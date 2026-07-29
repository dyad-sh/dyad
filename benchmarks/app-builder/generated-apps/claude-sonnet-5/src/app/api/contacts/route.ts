import { NextResponse } from "next/server";
import { sql } from "@/db";
import { requireWorkspaceContext, requireWorkspaceWriteContext } from "@/lib/auth/require-user";
import { isValidationError, validateEmail, validateOptionalString, validateRequiredString } from "@/lib/validation";

export async function GET() {
  const { context, error } = await requireWorkspaceContext();
  if (error) return error;

  const rows = await sql`
    SELECT c.id, c.name, c.email, c.phone, c.title,
           c.company_id AS "companyId", co.name AS "companyName"
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    WHERE c.workspace_id = ${context.workspace.id}
    ORDER BY c.created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const { context, error } = await requireWorkspaceWriteContext();
  if (error) return error;

  const body = await request.json();

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

  const [contact] = await sql`
    INSERT INTO contacts (user_id, workspace_id, name, email, phone, title, company_id)
    VALUES (${context.user.id}, ${context.workspace.id}, ${name}, ${email}, ${phone}, ${title}, ${companyId})
    RETURNING id, name, email, phone, title, company_id AS "companyId"
  `;

  await sql`
    INSERT INTO contact_activities (workspace_id, contact_id, type, body, actor_user_id)
    VALUES (${context.workspace.id}, ${contact.id}, 'created', 'Contact created', ${context.user.id})
  `;

  return NextResponse.json(contact);
}
