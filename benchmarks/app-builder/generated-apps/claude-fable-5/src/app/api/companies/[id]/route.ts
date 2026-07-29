import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { badRequest, firstTooLongField } from '@/lib/validate';
import {
  canWrite,
  forbidden,
  getWorkspaceContext,
  suppliedWorkspaceViolation,
} from '@/lib/workspace';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  if (suppliedWorkspaceViolation(ctx, request.url)) return forbidden();
  const { id } = await params;

  const rows = await sql`
    SELECT id, name, domain FROM companies
    WHERE id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
  `;
  if (rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json(rows[0]);
}

export async function PATCH(request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  const { id } = await params;

  const existing = await sql`
    SELECT id, name, domain FROM companies
    WHERE id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
  `;
  if (existing.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const current = existing[0];
  const body = await request.json();
  if (suppliedWorkspaceViolation(ctx, request.url, body)) return forbidden();
  if (!canWrite(ctx)) return forbidden();

  const name =
    typeof body.name === 'string' ? body.name.trim() : (current.name as string);
  if (!name) return badRequest('Name is required');
  const domain =
    typeof body.domain === 'string' ? body.domain.trim() : (current.domain as string);
  const tooLong = firstTooLongField({ name, domain });
  if (tooLong) return badRequest(`${tooLong} must be 500 characters or fewer`);

  const rows = await sql`
    UPDATE companies SET name = ${name}, domain = ${domain}
    WHERE id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
    RETURNING id, name, domain
  `;
  return Response.json(rows[0]);
}

export async function DELETE(request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  if (suppliedWorkspaceViolation(ctx, request.url)) return forbidden();
  if (!canWrite(ctx)) return forbidden();
  const { id } = await params;

  const rows = await sql`
    DELETE FROM companies
    WHERE id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
    RETURNING id
  `;
  if (rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json({ success: true });
}
