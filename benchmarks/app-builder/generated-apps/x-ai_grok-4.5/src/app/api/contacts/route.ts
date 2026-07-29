import { sql } from "@/db";
import { recordContactActivity } from "@/lib/activity";
import { requireSessionUser } from "@/lib/auth/session";
import { canWriteRecords, forbiddenResponse } from "@/lib/permissions";
import {
  clampString,
  sanitizeWriteBody,
  validateOptionalEmail,
  validateRequiredName,
} from "@/lib/validation";
import { requireActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const context = await requireActiveWorkspace(user);
  if (context instanceof Response) return context;

  const contacts = await sql`
    SELECT
      c.id,
      c.name,
      c.email,
      c.phone,
      c.title,
      c.company_id,
      co.name AS company_name,
      c.created_at,
      c.updated_at
    FROM contacts c
    LEFT JOIN companies co
      ON co.id = c.company_id AND co.workspace_id = c.workspace_id
    WHERE c.workspace_id = ${context.workspaceId}
    ORDER BY c.created_at DESC
  `;

  return Response.json(contacts);
}

export async function POST(request: Request) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const context = await requireActiveWorkspace(user);
  if (context instanceof Response) return context;

  if (!canWriteRecords(context.role)) {
    return forbiddenResponse();
  }

  let body: Record<string, unknown>;
  try {
    body = sanitizeWriteBody(await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = validateRequiredName(body.name);
  if (name instanceof Response) return name;

  const email = validateOptionalEmail(body.email);
  if (email instanceof Response) return email;

  const phone = clampString(body.phone, "Phone");
  if (phone instanceof Response) return phone;

  const title = clampString(body.title, "Title");
  if (title instanceof Response) return title;

  let companyId: string | null =
    body.company_id && String(body.company_id).trim()
      ? String(body.company_id).trim()
      : null;

  if (companyId) {
    const companies = await sql`
      SELECT id FROM companies
      WHERE id = ${companyId} AND workspace_id = ${context.workspaceId}
      LIMIT 1
    `;
    if (companies.length === 0) {
      return Response.json({ error: "Company not found" }, { status: 400 });
    }
  }

  const rows = await sql`
    INSERT INTO contacts (
      user_id,
      workspace_id,
      name,
      email,
      phone,
      title,
      company_id
    )
    VALUES (
      ${user.id},
      ${context.workspaceId},
      ${name},
      ${email},
      ${phone},
      ${title},
      ${companyId}
    )
    RETURNING
      id,
      name,
      email,
      phone,
      title,
      company_id,
      created_at,
      updated_at
  `;

  const contact = rows[0];

  await recordContactActivity({
    workspaceId: context.workspaceId,
    contactId: String(contact.id),
    type: "contact_created",
    body: `Contact "${name}" was created`,
    actor: user,
  });

  let company_name: string | null = null;
  if (contact.company_id) {
    const companies = await sql`
      SELECT name FROM companies
      WHERE id = ${contact.company_id} AND workspace_id = ${context.workspaceId}
      LIMIT 1
    `;
    company_name = (companies[0]?.name as string | undefined) ?? null;
  }

  return Response.json({ ...contact, company_name }, { status: 201 });
}
