import { sql } from "@/db";
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

export async function GET() {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const context = await requireActiveWorkspace(user);
  if (context instanceof Response) return context;

  const deals = await sql`
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
    WHERE d.workspace_id = ${context.workspaceId}
    ORDER BY d.created_at DESC
  `;

  return Response.json(deals);
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

  const title = clampString(body.title, "Title", { required: true });
  if (title instanceof Response) return title;

  const amount = validateDealAmount(body.amount);
  if (amount instanceof Response) return amount;

  const stage = validateDealStage(body.stage ?? "lead");
  if (stage instanceof Response) return stage;

  let contactId: string | null =
    body.contact_id && String(body.contact_id).trim()
      ? String(body.contact_id).trim()
      : null;

  if (contactId) {
    const contacts = await sql`
      SELECT id FROM contacts
      WHERE id = ${contactId} AND workspace_id = ${context.workspaceId}
      LIMIT 1
    `;
    if (contacts.length === 0) {
      return Response.json({ error: "Contact not found" }, { status: 400 });
    }
  }

  const rows = await sql`
    INSERT INTO deals (workspace_id, title, amount, stage, contact_id, created_by)
    VALUES (
      ${context.workspaceId},
      ${title},
      ${amount},
      ${stage},
      ${contactId},
      ${user.id}
    )
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
  let contact_name: string | null = null;
  if (deal.contact_id) {
    const contacts = await sql`
      SELECT name FROM contacts
      WHERE id = ${deal.contact_id} AND workspace_id = ${context.workspaceId}
      LIMIT 1
    `;
    contact_name = (contacts[0]?.name as string | undefined) ?? null;
  }

  return Response.json({ ...deal, contact_name }, { status: 201 });
}
