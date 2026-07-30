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

export async function GET(request: Request) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  if (suppliedWorkspaceViolation(ctx, request.url)) return forbidden();

  const rows = await sql`
    SELECT c.id, c.name, c.email, c.phone, c.title, c.company_id,
           co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id AND co.workspace_id = ${ctx.activeWorkspaceId}
    WHERE c.workspace_id = ${ctx.activeWorkspaceId}
    ORDER BY c.created_at DESC
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
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email && !isValidEmail(email)) return badRequest('Invalid email address');
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  const tooLong = firstTooLongField({ name, email, phone, title });
  if (tooLong) return badRequest(`${tooLong} must be 500 characters or fewer`);

  const companyId =
    typeof body.company_id === 'string' && body.company_id ? body.company_id : null;
  if (companyId) {
    const owned = await sql`
      SELECT id FROM companies
      WHERE id = ${companyId} AND workspace_id = ${ctx.activeWorkspaceId}
    `;
    if (owned.length === 0) return badRequest('Invalid company');
  }

  const rows = await sql`
    INSERT INTO contacts (user_id, workspace_id, name, email, phone, title, company_id)
    VALUES (${ctx.user.id}, ${ctx.activeWorkspaceId}, ${name}, ${email}, ${phone}, ${title}, ${companyId})
    RETURNING id, name, email, phone, title, company_id
  `;
  const contact = rows[0];
  await recordActivity(
    ctx.activeWorkspaceId,
    contact.id as string,
    'created',
    `Contact "${name}" was created`,
    ctx.user,
  );
  return Response.json(contact, { status: 201 });
}
