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

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const active = await requireActiveWorkspace(user);
  if (active instanceof Response) return active;

  const { id } = await context.params;

  const rows = await sql`
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
    WHERE c.id = ${id} AND c.workspace_id = ${active.workspaceId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(rows[0]);
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const active = await requireActiveWorkspace(user);
  if (active instanceof Response) return active;

  if (!canWriteRecords(active.role)) {
    return forbiddenResponse();
  }

  const { id } = await context.params;

  const existing = await sql`
    SELECT id, name, email, phone, title, company_id
    FROM contacts
    WHERE id = ${id} AND workspace_id = ${active.workspaceId}
    LIMIT 1
  `;

  if (existing.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = sanitizeWriteBody(await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const current = existing[0];
  const name =
    body.name !== undefined
      ? validateRequiredName(body.name)
      : String(current.name);
  if (name instanceof Response) return name;

  const email =
    body.email !== undefined
      ? validateOptionalEmail(body.email)
      : String(current.email ?? "");
  if (email instanceof Response) return email;

  const phone =
    body.phone !== undefined
      ? clampString(body.phone, "Phone")
      : String(current.phone ?? "");
  if (phone instanceof Response) return phone;

  const title =
    body.title !== undefined
      ? clampString(body.title, "Title")
      : String(current.title ?? "");
  if (title instanceof Response) return title;

  let companyId: string | null =
    body.company_id !== undefined
      ? body.company_id && String(body.company_id).trim()
        ? String(body.company_id).trim()
        : null
      : (current.company_id as string | null);

  if (companyId) {
    const companies = await sql`
      SELECT id FROM companies
      WHERE id = ${companyId} AND workspace_id = ${active.workspaceId}
      LIMIT 1
    `;
    if (companies.length === 0) {
      return Response.json({ error: "Company not found" }, { status: 400 });
    }
  }

  const rows = await sql`
    UPDATE contacts
    SET
      name = ${name},
      email = ${email},
      phone = ${phone},
      title = ${title},
      company_id = ${companyId},
      updated_at = NOW()
    WHERE id = ${id} AND workspace_id = ${active.workspaceId}
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
    workspaceId: active.workspaceId,
    contactId: String(contact.id),
    type: "contact_updated",
    body: `Contact "${name}" was updated`,
    actor: user,
  });

  let company_name: string | null = null;
  if (contact.company_id) {
    const companies = await sql`
      SELECT name FROM companies
      WHERE id = ${contact.company_id} AND workspace_id = ${active.workspaceId}
      LIMIT 1
    `;
    company_name = (companies[0]?.name as string | undefined) ?? null;
  }

  return Response.json({ ...contact, company_name });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const active = await requireActiveWorkspace(user);
  if (active instanceof Response) return active;

  if (!canWriteRecords(active.role)) {
    return forbiddenResponse();
  }

  const { id } = await context.params;

  const rows = await sql`
    DELETE FROM contacts
    WHERE id = ${id} AND workspace_id = ${active.workspaceId}
    RETURNING id
  `;

  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
