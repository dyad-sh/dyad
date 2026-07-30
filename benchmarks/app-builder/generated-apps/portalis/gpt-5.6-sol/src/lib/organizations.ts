import "server-only";

import { sql } from "@/db";

export type OrganizationRole = "org_admin" | "org_member";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  description: string;
};

export type OrganizationAccess = Organization & { role: OrganizationRole };

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getOrganizations(userId: string): Promise<Organization[]> {
  const rows = await sql`
    SELECT o.id, o.name, o.slug, o.description
    FROM organizations o
    JOIN organization_memberships m ON m.organization_id = o.id
    WHERE m.user_id = ${userId}::uuid
    ORDER BY o.name ASC
  `;
  return rows as Organization[];
}

export async function getMemberships(userId: string): Promise<{ orgId: string; role: OrganizationRole }[]> {
  const rows = await sql`
    SELECT organization_id AS "orgId", role
    FROM organization_memberships
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at ASC
  `;
  return rows as { orgId: string; role: OrganizationRole }[];
}

export async function getOrganizationAccess(orgId: string, userId: string): Promise<OrganizationAccess | null> {
  if (!uuidPattern.test(orgId)) return null;
  const rows = await sql`
    SELECT o.id, o.name, o.slug, o.description, m.role
    FROM organizations o
    JOIN organization_memberships m ON m.organization_id = o.id
    WHERE o.id = ${orgId}::uuid AND m.user_id = ${userId}::uuid
    LIMIT 1
  `;
  return (rows[0] as OrganizationAccess | undefined) ?? null;
}

export async function getAuthorizedOrganization(orgId: string, userId: string): Promise<OrganizationAccess | null> {
  return getOrganizationAccess(orgId, userId);
}

export type OrganizationMember = {
  user_id: string;
  email: string;
  role: OrganizationRole;
};

export async function getOrganizationMembers(orgId: string): Promise<OrganizationMember[]> {
  const rows = await sql`
    SELECT m.user_id, u.email, m.role
    FROM organization_memberships m
    JOIN app_users u ON u.id = m.user_id
    WHERE m.organization_id = ${orgId}::uuid
    ORDER BY u.email ASC
  `;
  return rows as OrganizationMember[];
}

export type OrganizationInvite = {
  id: string;
  email: string;
  role: OrganizationRole;
  token: string;
  status: "pending" | "accepted" | "revoked";
};

export async function getOrganizationInvites(orgId: string): Promise<OrganizationInvite[]> {
  const rows = await sql`
    SELECT id, email, role, token, status
    FROM organization_invites
    WHERE organization_id = ${orgId}::uuid
    ORDER BY created_at DESC
  `;
  return rows as OrganizationInvite[];
}

export type Project = { id: string; name: string; description: string };

export async function getProjects(orgId: string): Promise<Project[]> {
  const rows = await sql`
    SELECT id, name, description
    FROM projects
    WHERE organization_id = ${orgId}::uuid
    ORDER BY updated_at DESC
  `;
  return rows as Project[];
}

export async function getProject(orgId: string, projectId: string): Promise<Project | null> {
  if (!uuidPattern.test(projectId)) return null;
  const rows = await sql`
    SELECT id, name, description
    FROM projects
    WHERE id = ${projectId}::uuid AND organization_id = ${orgId}::uuid
    LIMIT 1
  `;
  return (rows[0] as Project | undefined) ?? null;
}
