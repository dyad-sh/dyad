import { sql } from "@/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string) => UUID_RE.test(value);

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ROLES = ["org_admin", "org_member"] as const;

export type Org = {
  id: string;
  name: string;
  slug: string;
  description: string;
  role: string;
};

export async function getOrgForUser(
  orgId: string,
  userId: string,
): Promise<Org | null> {
  if (!UUID_RE.test(orgId)) return null;
  const rows = await sql`
    SELECT o.id, o.name, o.slug, o.description, m.role
    FROM organizations o
    JOIN memberships m ON m.org_id = o.id
    WHERE o.id = ${orgId} AND m.user_id = ${userId}
  `;
  return (rows[0] as Org | undefined) ?? null;
}

export async function getOrgsForUser(userId: string) {
  const rows = await sql`
    SELECT o.id, o.name, o.slug, o.description, m.role
    FROM organizations o
    JOIN memberships m ON m.org_id = o.id
    WHERE m.user_id = ${userId}
    ORDER BY o.created_at ASC
  `;
  return rows as Org[];
}
