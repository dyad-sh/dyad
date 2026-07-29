import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { recordActivity } from '@/lib/activity';
import { badRequest, MAX_STRING_LENGTH } from '@/lib/validate';
import {
  canWrite,
  forbidden,
  getWorkspaceContext,
  suppliedWorkspaceViolation,
} from '@/lib/workspace';

type Params = { params: Promise<{ id: string }> };

async function contactInWorkspace(id: string, workspaceId: string) {
  const rows = await sql`
    SELECT id FROM contacts WHERE id = ${id} AND workspace_id = ${workspaceId}
  `;
  return rows.length > 0;
}

export async function GET(request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  if (suppliedWorkspaceViolation(ctx, request.url)) return forbidden();
  const { id } = await params;

  if (!(await contactInWorkspace(id, ctx.activeWorkspaceId))) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const rows = await sql`
    SELECT id, type, body, actor_email, created_at
    FROM activities
    WHERE contact_id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
    ORDER BY created_at DESC
  `;
  return Response.json(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      body: r.body,
      actorEmail: r.actor_email,
      createdAt: r.created_at,
    })),
  );
}

export async function POST(request: Request, { params }: Params) {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();
  const { id } = await params;

  const body = await request.json();
  if (suppliedWorkspaceViolation(ctx, request.url, body)) return forbidden();
  if (!canWrite(ctx)) return forbidden();

  if (!(await contactInWorkspace(id, ctx.activeWorkspaceId))) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const raw = body.body ?? body.text ?? body.note;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return badRequest('Note text is required');
  if (text.length > MAX_STRING_LENGTH) {
    return badRequest('note must be 500 characters or fewer');
  }

  await recordActivity(ctx.activeWorkspaceId, id, 'note', text, ctx.user);
  const rows = await sql`
    SELECT id, type, body, actor_email, created_at
    FROM activities
    WHERE contact_id = ${id} AND workspace_id = ${ctx.activeWorkspaceId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const created = rows[0];
  return Response.json(
    {
      id: created.id,
      type: created.type,
      body: created.body,
      actorEmail: created.actor_email,
      createdAt: created.created_at,
    },
    { status: 201 },
  );
}
