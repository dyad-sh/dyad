import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { recordActivity } from '@/lib/activity';
import { badRequest, firstTooLongField, isValidEmail } from '@/lib/validate';
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
    SELECT c.id, c.name, c.email, c.phone, c.title, c.company_id,
           co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id AND co.workspace_id = ${ctx.activeWorkspaceId}
    WHERE c.id = ${id} AND c.workspace_id = ${ctx.activeWorkspaceId}
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
    SELECT id, name, email, phone, title, company_id
    FROM contacts WHERE id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
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
  const email =
    typeof body.email === 'string' ? body.email.trim() : (current.email as string);
  if (email && !isValidEmail(email)) return badRequest('Invalid email address');
  const phone =
    typeof body.phone === 'string' ? body.phone.trim() : (current.phone as string);
  const title =
    typeof body.title === 'string' ? body.title.trim() : (current.title as string);

  const tooLong = firstTooLongField({ name, email, phone, title });
  if (tooLong) return badRequest(`${tooLong} must be 500 characters or fewer`);

  let companyId: string | null = current.company_id as string | null;
  if ('company_id' in body) {
    companyId =
      typeof body.company_id === 'string' && body.company_id ? body.company_id : null;
  }
  if (companyId && companyId !== current.company_id) {
    const owned = await sql`
      SELECT id FROM companies
      WHERE id = ${companyId} AND workspace_id = ${ctx.activeWorkspaceId}
    `;
    if (owned.length === 0) return badRequest('Invalid company');
  }

  const rows = await sql`
    UPDATE contacts
    SET name = ${name}, email = ${email}, phone = ${phone}, title = ${title}, company_id = ${companyId}
    WHERE id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
    RETURNING id, name, email, phone, title, company_id
  `;
  await recordActivity(
    ctx.activeWorkspaceId,
    id,
    'updated',
    `Contact "${name}" was updated`,
    ctx.user,
  );
  return Response.json(rows[0]);
}

export async function DELETE(request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  if (suppliedWorkspaceViolation(ctx, request.url)) return forbidden();
  if (!canWrite(ctx)) return forbidden();
  const { id } = await params;

  const rows = await sql`
    DELETE FROM contacts
    WHERE id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
    RETURNING id
  `;
  if (rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json({ success: true });
}
