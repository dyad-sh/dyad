import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { recordActivity } from '@/lib/activity';
import { isDealStage, parseAmount } from '@/lib/deals';
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
    SELECT d.id, d.title, d.amount, d.stage, d.contact_id,
           c.name AS contact_name
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id AND c.workspace_id = ${ctx.activeWorkspaceId}
    WHERE d.id = ${id} AND d.workspace_id = ${ctx.activeWorkspaceId}
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
    SELECT id, title, amount, stage, contact_id FROM deals
    WHERE id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
  `;
  if (existing.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const current = existing[0];
  const body = await request.json();
  if (suppliedWorkspaceViolation(ctx, request.url, body)) return forbidden();
  if (!canWrite(ctx)) return forbidden();

  const title =
    typeof body.title === 'string' ? body.title.trim() : (current.title as string);
  if (!title) return badRequest('Title is required');
  const tooLong = firstTooLongField({ title });
  if (tooLong) return badRequest('title must be 500 characters or fewer');

  let amount = current.amount as number;
  if ('amount' in body) {
    const parsed = parseAmount(body.amount);
    if (parsed === null) {
      return badRequest('Amount must be a non-negative number');
    }
    amount = parsed;
  }

  const previousStage = current.stage as string;
  let stage = previousStage;
  if ('stage' in body) {
    if (!isDealStage(body.stage)) return badRequest('Invalid stage');
    stage = body.stage;
  }

  let contactId: string | null = current.contact_id as string | null;
  if ('contact_id' in body) {
    contactId =
      typeof body.contact_id === 'string' && body.contact_id ? body.contact_id : null;
  }
  if (contactId && contactId !== current.contact_id) {
    const owned = await sql`
      SELECT id FROM contacts
      WHERE id = ${contactId} AND workspace_id = ${ctx.activeWorkspaceId}
    `;
    if (owned.length === 0) return badRequest('Invalid contact');
  }

  const rows = await sql`
    UPDATE deals
    SET title = ${title}, amount = ${amount}, stage = ${stage}, contact_id = ${contactId}
    WHERE id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
    RETURNING id, title, amount, stage, contact_id
  `;

  if (stage !== previousStage && contactId) {
    await recordActivity(
      ctx.activeWorkspaceId,
      contactId,
      'stage_change',
      `Deal "${title}" moved from ${previousStage} to ${stage}`,
      ctx.user,
    );
  }

  return Response.json(rows[0]);
}

export async function DELETE(request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  if (suppliedWorkspaceViolation(ctx, request.url)) return forbidden();
  if (!canWrite(ctx)) return forbidden();
  const { id } = await params;

  const rows = await sql`
    DELETE FROM deals
    WHERE id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
    RETURNING id
  `;
  if (rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json({ success: true });
}
