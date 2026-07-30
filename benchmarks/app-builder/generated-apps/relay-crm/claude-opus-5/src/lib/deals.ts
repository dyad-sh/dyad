import { sql, type DealStage, type DealWithContact, DEAL_STAGES } from "@/db";

export function isDealStage(value: unknown): value is DealStage {
  return (
    typeof value === "string" && (DEAL_STAGES as readonly string[]).includes(value)
  );
}

export async function listDeals(
  workspaceId: string,
): Promise<DealWithContact[]> {
  const rows = (await sql`
    SELECT d.*, c.name AS contact_name
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE d.workspace_id = ${workspaceId}
    ORDER BY d.created_at DESC
  `) as DealWithContact[];
  return rows.map((d) => ({ ...d, amount: Number(d.amount) }));
}

export async function getDeal(
  workspaceId: string,
  id: string,
): Promise<DealWithContact | null> {
  const rows = (await sql`
    SELECT d.*, c.name AS contact_name
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE d.workspace_id = ${workspaceId} AND d.id = ${id}
  `) as DealWithContact[];
  const deal = rows[0];
  return deal ? { ...deal, amount: Number(deal.amount) } : null;
}

async function resolveContactId(
  workspaceId: string,
  contactId: string | null | undefined,
): Promise<string | null> {
  if (!contactId) return null;
  const rows = (await sql`
    SELECT id FROM contacts WHERE id = ${contactId} AND workspace_id = ${workspaceId}
  `) as { id: string }[];
  return rows[0]?.id ?? null;
}

export type DealInput = {
  title: string;
  amount: number;
  stage: DealStage;
  contact_id?: string | null;
};

export async function createDeal(
  workspaceId: string,
  userId: string,
  data: DealInput,
): Promise<DealWithContact> {
  const contactId = await resolveContactId(workspaceId, data.contact_id);
  const rows = (await sql`
    INSERT INTO deals (workspace_id, user_id, title, amount, stage, contact_id)
    VALUES (${workspaceId}, ${userId}, ${data.title}, ${data.amount}, ${data.stage}, ${contactId})
    RETURNING id
  `) as { id: string }[];
  return (await getDeal(workspaceId, rows[0].id))!;
}

export async function updateDeal(
  workspaceId: string,
  id: string,
  data: Partial<DealInput>,
): Promise<DealWithContact | null> {
  const existing = await getDeal(workspaceId, id);
  if (!existing) return null;
  const contactId =
    data.contact_id === undefined
      ? existing.contact_id
      : await resolveContactId(workspaceId, data.contact_id);

  await sql`
    UPDATE deals SET
      title = ${data.title ?? existing.title},
      amount = ${data.amount ?? existing.amount},
      stage = ${data.stage ?? existing.stage},
      contact_id = ${contactId}
    WHERE id = ${id} AND workspace_id = ${workspaceId}
  `;
  return getDeal(workspaceId, id);
}

export async function deleteDeal(
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM deals WHERE id = ${id} AND workspace_id = ${workspaceId} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}
