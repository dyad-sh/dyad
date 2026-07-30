import { redirect } from "next/navigation";
import { sql, withTransaction } from "@/db";
import { insertAuditLog } from "@/lib/audit";
import { auth } from "@/lib/auth/server";
import type { OrgRole } from "@/lib/roles";

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
  created_at: string;
  updated_at: string;
};

export type OrgMember = {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  email: string;
  name: string;
  created_at: string;
};

export type MembershipWithOrg = Organization & {
  role: OrgRole;
};

function normalizeUser(user: {
  id: string;
  email: string;
  name?: string | null;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? "",
  };
}

export async function requireUser(): Promise<SessionUser> {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }
  return normalizeUser(session.user);
}

export async function getOptionalUser(): Promise<SessionUser | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return null;
  }
  return normalizeUser(session.user);
}

export async function getUserOrganizations(
  userId: string,
): Promise<MembershipWithOrg[]> {
  const rows = await sql`
    SELECT
      o.id,
      o.name,
      o.slug,
      o.description,
      o.created_at,
      o.updated_at,
      m.role
    FROM organization_members m
    INNER JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ${userId}
    ORDER BY o.name ASC
  `;
  return rows as MembershipWithOrg[];
}

export async function getOrganizationById(
  orgId: string,
): Promise<Organization | null> {
  const rows = await sql`
    SELECT id, name, slug, description, created_at, updated_at
    FROM organizations
    WHERE id = ${orgId}
    LIMIT 1
  `;
  return (rows[0] as Organization | undefined) ?? null;
}

export async function getMembership(
  orgId: string,
  userId: string,
): Promise<OrgMember | null> {
  const rows = await sql`
    SELECT id, org_id, user_id, role, email, name, created_at
    FROM organization_members
    WHERE org_id = ${orgId} AND user_id = ${userId}
    LIMIT 1
  `;
  return (rows[0] as OrgMember | undefined) ?? null;
}

/**
 * Ensures the signed-in user belongs to the org.
 * - Signed-out → redirect to sign-in
 * - Signed-in non-member → null (caller should show not-authorized)
 */
export async function requireOrgAccess(orgId: string): Promise<{
  user: SessionUser;
  org: Organization;
  membership: OrgMember;
} | null> {
  const user = await requireUser();
  const membership = await getMembership(orgId, user.id);
  if (!membership) {
    return null;
  }
  const org = await getOrganizationById(orgId);
  if (!org) {
    return null;
  }
  return { user, org, membership };
}

export async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  const rows = await sql`
    SELECT id, org_id, user_id, role, email, name, created_at
    FROM organization_members
    WHERE org_id = ${orgId}
    ORDER BY created_at ASC
  `;
  return rows as OrgMember[];
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && slug.length >= 2 && slug.length <= 64;
}

export async function createOrganization(input: {
  name: string;
  slug: string;
  user: SessionUser;
}): Promise<{ org?: Organization; error?: string }> {
  const name = input.name.trim();
  const slug = normalizeSlug(input.slug);

  if (!name) {
    return { error: "Organization name is required." };
  }
  if (!isValidSlug(slug)) {
    return {
      error:
        "Slug must be lowercase letters, numbers, and hyphens (2–64 chars).",
    };
  }

  const existing = await sql`
    SELECT id FROM organizations WHERE slug = ${slug} LIMIT 1
  `;
  if (existing.length > 0) {
    return { error: "That slug is already taken." };
  }

  try {
    const org = await withTransaction(async (tx) => {
      const orgRows = await tx`
        INSERT INTO organizations (name, slug)
        VALUES (${name}, ${slug})
        RETURNING id, name, slug, description, created_at, updated_at
      `;
      const created = orgRows[0] as Organization;

      await tx`
        INSERT INTO organization_members (org_id, user_id, role, email, name)
        VALUES (
          ${created.id},
          ${input.user.id},
          ${"org_admin"},
          ${input.user.email},
          ${input.user.name}
        )
      `;

      await insertAuditLog(tx, {
        orgId: created.id,
        actor: input.user,
        action: "org.created",
        target: created.id,
        metadata: { name: created.name, slug: created.slug },
      });

      return created;
    });

    return { org };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.toLowerCase().includes("unique") || message.includes("23505")) {
      return { error: "That slug is already taken." };
    }
    return { error: "Failed to create organization. Please try again." };
  }
}

export async function updateOrganization(
  orgId: string,
  input: { name: string; description: string },
  actor: SessionUser,
): Promise<{ org?: Organization; error?: string }> {
  const name = input.name.trim();
  const description = input.description.trim();

  if (!name) {
    return { error: "Organization name is required." };
  }

  try {
    const org = await withTransaction(async (tx) => {
      const rows = await tx`
        UPDATE organizations
        SET
          name = ${name},
          description = ${description},
          updated_at = now()
        WHERE id = ${orgId}
        RETURNING id, name, slug, description, created_at, updated_at
      `;

      if (!rows[0]) {
        return null;
      }

      const updated = rows[0] as Organization;
      await insertAuditLog(tx, {
        orgId,
        actor,
        action: "org.updated",
        target: orgId,
        metadata: { name: updated.name },
      });
      return updated;
    });

    if (!org) {
      return { error: "Organization not found." };
    }

    return { org };
  } catch {
    return { error: "Failed to update organization." };
  }
}
