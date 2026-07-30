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

export async function GET() {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const context = await requireActiveWorkspace(user);
  if (context instanceof Response) return context;

  const companies = await sql`
    SELECT id, name, domain, created_at, updated_at
    FROM companies
    WHERE workspace_id = ${context.workspaceId}
    ORDER BY created_at DESC
  `;

  return Response.json(companies);
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

  const domain = clampString(body.domain, "Domain");
  if (domain instanceof Response) return domain;

  const rows = await sql`
    INSERT INTO companies (user_id, workspace_id, name, domain)
    VALUES (${user.id}, ${context.workspaceId}, ${name}, ${domain})
    RETURNING id, name, domain, created_at, updated_at
  `;

  return Response.json(rows[0], { status: 201 });
}
