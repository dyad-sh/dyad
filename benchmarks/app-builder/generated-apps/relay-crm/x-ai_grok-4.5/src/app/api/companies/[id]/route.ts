import { sql } from "@/db";
import { requireSessionUser } from "@/lib/auth/session";
import { canWriteRecords, forbiddenResponse } from "@/lib/permissions";
import {
  clampString,
  sanitizeWriteBody,
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
    SELECT id, name, domain, created_at, updated_at
    FROM companies
    WHERE id = ${id} AND workspace_id = ${active.workspaceId}
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
    SELECT id, name, domain
    FROM companies
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

  const domain =
    body.domain !== undefined
      ? clampString(body.domain, "Domain")
      : String(current.domain ?? "");
  if (domain instanceof Response) return domain;

  const rows = await sql`
    UPDATE companies
    SET name = ${name}, domain = ${domain}, updated_at = NOW()
    WHERE id = ${id} AND workspace_id = ${active.workspaceId}
    RETURNING id, name, domain, created_at, updated_at
  `;

  return Response.json(rows[0]);
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
    DELETE FROM companies
    WHERE id = ${id} AND workspace_id = ${active.workspaceId}
    RETURNING id
  `;

  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
