import { redirect } from "next/navigation";
import { sql } from "@/db";
import { auth } from "@/lib/auth/server";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  description: string;
};

export type Member = {
  user_id: string;
  email: string;
  name: string;
  role: string;
};

export type Project = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type Invite = {
  id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  created_at: string;
};

export type OrgRole = "org_admin" | "org_member";

export async function getSessionUser(): Promise<SessionUser | null> {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user) return null;
  return {
    id: String(user.id),
    email: user.email ?? "",
    name: user.name ?? "",
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in");
  return user;
}

export async function listUserOrgs(userId: string): Promise<Organization[]> {
  const rows = await sql`
    SELECT o.id, o.name, o.slug, o.description
    FROM organizations o
    JOIN org_members m ON m.org_id = o.id
    WHERE m.user_id = ${userId}
    ORDER BY o.name ASC
  `;
  return rows as Organization[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the org plus the caller's membership, or null when the signed-in
 * user is not a member (or the org does not exist).
 */
export async function getOrgForMember(
  orgId: string,
  userId: string,
): Promise<{ org: Organization; role: string } | null> {
  if (!UUID_RE.test(orgId)) return null;
  const rows = await sql`
    SELECT o.id, o.name, o.slug, o.description, m.role
    FROM organizations o
    JOIN org_members m ON m.org_id = o.id AND m.user_id = ${userId}
    WHERE o.id = ${orgId}::uuid
    LIMIT 1
  `;
  const row = rows[0] as (Organization & { role: string }) | undefined;
  if (!row) return null;
  return {
    org: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
    },
    role: row.role,
  };
}

export async function listOrgMembers(orgId: string): Promise<Member[]> {
  const rows = await sql`
    SELECT user_id, email, name, role
    FROM org_members
    WHERE org_id = ${orgId}::uuid
    ORDER BY created_at ASC
  `;
  return rows as Member[];
}

export async function listOrgInvites(orgId: string): Promise<Invite[]> {
  const rows = await sql`
    SELECT id, email, role, token, status, created_at
    FROM invites
    WHERE org_id = ${orgId}::uuid
    ORDER BY created_at DESC
  `;
  return rows as Invite[];
}

export async function listOrgProjects(orgId: string): Promise<Project[]> {
  const rows = await sql`
    SELECT id, org_id, name, description, created_at, updated_at
    FROM projects
    WHERE org_id = ${orgId}::uuid
    ORDER BY created_at DESC
  `;
  return rows as Project[];
}

/** Only returns the project when it belongs to the given org. */
export async function getOrgProject(
  orgId: string,
  projectId: string,
): Promise<Project | null> {
  if (!isUuid(orgId) || !isUuid(projectId)) return null;
  const rows = await sql`
    SELECT id, org_id, name, description, created_at, updated_at
    FROM projects
    WHERE id = ${projectId}::uuid AND org_id = ${orgId}::uuid
    LIMIT 1
  `;
  return (rows[0] as Project | undefined) ?? null;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export async function getUserMemberships(
  userId: string,
): Promise<{ orgId: string; role: string }[]> {
  const rows = await sql`
    SELECT org_id, role FROM org_members WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `;
  return (rows as { org_id: string; role: string }[]).map((r) => ({
    orgId: r.org_id,
    role: r.role,
  }));
}
