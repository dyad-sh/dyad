import { sql } from "@/db";
import { recordContactActivity } from "@/lib/activity";
import { requireSessionUser } from "@/lib/auth/session";
import { canWriteRecords, forbiddenResponse } from "@/lib/permissions";
import {
  clampString,
  sanitizeWriteBody,
  validateDealAmount,
  validateDealStage,
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
      d.id,
      d.title,
      d.amount,
      d.stage,
      d.contact_id,
      c.name AS contact_name,
      d.workspace_id,
      d.created_at,
      d.updated_at
    FROM deals d
    LEFT JOIN contacts c
      ON c.id = d.contact_id AND c.workspace_id = d.workspace_id
    WHERE d.id = ${id} AND d.workspace_id = ${active.workspaceId}
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
    SELECT id, title, amount, stage, contact_id
    FROM deals
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
  const title =
    body.title !== undefined
      ? clampString(body.title, "Title", { required: true })
      : String(current.title);
  if (title instanceof Response) return title;

  let amount = Number(current.amount);
  if (body.amount !== undefined) {
    const validated = validateDealAmount(body.amount);
    if (validated instanceof Response) return validated;
    amount = validated;
  }

  let stage = String(current.stage);
  if (body.stage !== undefined) {
    const validated = validateDealStage(body.stage);
    if (validated instanceof Response) return validated;
    stage = validated;
  }

  let contactId: string | null =
    body.contact_id !== undefined
      ? body.contact_id && String(body.contact_id).trim()
        ? String(body.contact_id).trim()
        : null
      : (current.contact_id as string | null);

  if (contactId) {
    const contacts = await sql`
      SELECT id FROM contacts
      WHERE id = ${contactId} AND workspace_id = ${active.workspaceId}
      LIMIT 1
    `;
    if (contacts.length === 0) {
      return Response.json({ error: "Contact not found" }, { status: 400 });
    }
  }

  const previousStage = String(current.stage);
  const rows = await sql`
    UPDATE deals
    SET
      title = ${title},
      amount = ${amount},
      stage = ${stage},
      contact_id = ${contactId},
      updated_at = NOW()
    WHERE id = ${id} AND workspace_id = ${active.workspaceId}
    RETURNING
      id,
      title,
      amount,
      stage,
      contact_id,
      workspace_id,
      created_at,
      updated_at
  `;

  const deal = rows[0];

  if (deal.contact_id && previousStage !== stage) {
    await recordContactActivity({
      workspaceId: active.workspaceId,
      contactId: String(deal.contact_id),
      type: "deal_stage_changed",
      body: `Deal "${title}" moved from ${previousStage} to ${stage}`,
      actor: user,
    });
  }

  let contact_name: string | null = null;
  if (deal.contact_id) {
    const contacts = await sql`
      SELECT name FROM contacts
      WHERE id = ${deal.contact_id} AND workspace_id = ${active.workspaceId}
      LIMIT 1
    `;
    contact_name = (contacts[0]?.name as string | undefined) ?? null;
  }

  return Response.json({ ...deal, contact_name });
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
    DELETE FROM deals
    WHERE id = ${id} AND workspace_id = ${active.workspaceId}
    RETURNING id
  `;

  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
