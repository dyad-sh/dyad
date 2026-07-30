import { sql } from "@/db";

export type OrgRole = "org_admin" | "org_member";

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: OrgRole;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface OrgMember {
  user_id: string;
  role: OrgRole;
  email: string;
  name: string;
}

export async function getUserOrgs(userId: string): Promise<OrgSummary[]> {
  const rows = await sql`
    SELECT o.id, o.name, o.slug, o.description, m.role
    FROM organizations o
    JOIN org_members m ON m.org_id = o.id
    WHERE m.user_id = ${userId}
    ORDER BY o.created_at ASC
  `;
  return rows as unknown as OrgSummary[];
}

export async function getMembership(
  orgId: string,
  userId: string,
): Promise<{ role: OrgRole } | undefined> {
  const rows = await sql`
    SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}
  `;
  return rows[0] as { role: OrgRole } | undefined;
}

export async function getOrgById(orgId: string): Promise<Organization | undefined> {
  const rows = await sql`
    SELECT id, name, slug, description FROM organizations WHERE id = ${orgId}
  `;
  return rows[0] as Organization | undefined;
}

export async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  const rows = await sql`
    SELECT m.user_id, m.role, u.email, u.name
    FROM org_members m
    JOIN neon_auth.user u ON u.id = m.user_id
    WHERE m.org_id = ${orgId}
    ORDER BY m.created_at ASC
  `;
  return rows as unknown as OrgMember[];
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}
