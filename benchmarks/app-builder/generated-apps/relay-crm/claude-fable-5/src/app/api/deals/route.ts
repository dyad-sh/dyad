import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { isDealStage, parseAmount } from '@/lib/deals';
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
    SELECT d.id, d.title, d.amount, d.stage, d.contact_id,
           c.name AS contact_name
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id AND c.workspace_id = ${ctx.activeWorkspaceId}
    WHERE d.workspace_id = ${ctx.activeWorkspaceId}
    ORDER BY d.created_at DESC
  `;
  return Response.json(rows);
}

export async function POST(request: Request) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();

  const body = await request.json();
  if (suppliedWorkspaceViolation(ctx, request.url, body)) return forbidden();
  if (!canWrite(ctx)) return forbidden();

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return badRequest('Title is required');
  const tooLong = firstTooLongField({ title });
  if (tooLong) return badRequest('title must be 500 characters or fewer');
  const amount = parseAmount(body.amount);
  if (amount === null) {
    return badRequest('Amount must be a non-negative number');
  }
  const stage = body.stage ?? 'lead';
  if (!isDealStage(stage)) return badRequest('Invalid stage');
  const contactId =
    typeof body.contact_id === 'string' && body.contact_id ? body.contact_id : null;

  if (contactId) {
    const owned = await sql`
      SELECT id FROM contacts
      WHERE id = ${contactId} AND workspace_id = ${ctx.activeWorkspaceId}
    `;
    if (owned.length === 0) return badRequest('Invalid contact');
  }

  const rows = await sql`
    INSERT INTO deals (workspace_id, title, amount, stage, contact_id)
    VALUES (${ctx.activeWorkspaceId}, ${title}, ${amount}, ${stage}, ${contactId})
    RETURNING id, title, amount, stage, contact_id
  `;
  return Response.json(rows[0], { status: 201 });
}
