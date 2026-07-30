import { NextResponse } from "next/server";
import { sql } from "@/db";
import { requireWorkspaceContext, requireWorkspaceWriteContext } from "@/lib/auth/require-user";
import { isValidationError, validateOptionalString, validateRequiredString } from "@/lib/validation";

export async function GET() {
  const { context, error } = await requireWorkspaceContext();
  if (error) return error;

  const rows = await sql`
    SELECT id, name, domain
    FROM companies
    WHERE workspace_id = ${context.workspace.id}
    ORDER BY created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const { context, error } = await requireWorkspaceWriteContext();
  if (error) return error;

  const body = await request.json();

  const name = validateRequiredString(body.name, "Name");
  if (isValidationError(name)) return NextResponse.json(name, { status: 400 });

  const domain = validateOptionalString(body.domain, "Domain");
  if (isValidationError(domain)) return NextResponse.json(domain, { status: 400 });

  const rows = await sql`
    INSERT INTO companies (user_id, workspace_id, name, domain)
    VALUES (${context.user.id}, ${context.workspace.id}, ${name}, ${domain})
    RETURNING id, name, domain
  `;
  return NextResponse.json(rows[0]);
}
