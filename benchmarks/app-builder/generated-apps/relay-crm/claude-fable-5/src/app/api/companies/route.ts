import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { badRequest, firstTooLongField } from '@/lib/validate';
import {
  canWrite,
  forbidden,
  getWorkspaceContext,
  suppliedWorkspaceViolation,
} from '@/lib/workspace';

export async function GET(request: Request) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  if (suppliedWorkspaceViolation(ctx, request.url)) return forbidden();

  const rows = await sql`
    SELECT id, name, domain
    FROM companies
    WHERE workspace_id = ${ctx.activeWorkspaceId}
    ORDER BY created_at DESC
  `;
  return Response.json(rows);
}

export async function POST(request: Request) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();

  const body = await request.json();
  if (suppliedWorkspaceViolation(ctx, request.url, body)) return forbidden();
  if (!canWrite(ctx)) return forbidden();

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return badRequest('Name is required');
  const domain = typeof body.domain === 'string' ? body.domain.trim() : '';
  const tooLong = firstTooLongField({ name, domain });
  if (tooLong) return badRequest(`${tooLong} must be 500 characters or fewer`);

  const rows = await sql`
    INSERT INTO companies (user_id, workspace_id, name, domain)
    VALUES (${ctx.user.id}, ${ctx.activeWorkspaceId}, ${name}, ${domain})
    RETURNING id, name, domain
  `;
  return Response.json(rows[0], { status: 201 });
}
