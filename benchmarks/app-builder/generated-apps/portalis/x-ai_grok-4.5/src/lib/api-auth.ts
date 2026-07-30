import { auth } from "@/lib/auth/server";
import {
  getMembership,
  getOrganizationById,
  type OrgMember,
  type Organization,
  type SessionUser,
} from "@/lib/orgs";
import { isOrgAdmin, type OrgRole } from "@/lib/roles";

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function getApiUser(): Promise<SessionUser | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return null;
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? "",
  };
}

export type OrgApiContext = {
  user: SessionUser;
  org: Organization;
  membership: OrgMember;
};

/**
 * Authz for org-scoped API routes:
 * - 401 if signed out
 * - 404 if not a member (do not leak existence)
 * - optionally 403 if member but not admin
 */
export async function requireOrgApiAccess(
  orgId: string,
  options?: { admin?: boolean },
): Promise<{ ctx: OrgApiContext } | { response: Response }> {
  const user = await getApiUser();
  if (!user) {
    return { response: jsonError(401, "Unauthorized") };
  }

  const membership = await getMembership(orgId, user.id);
  if (!membership) {
    return { response: jsonError(404, "Not found") };
  }

  const org = await getOrganizationById(orgId);
  if (!org) {
    return { response: jsonError(404, "Not found") };
  }

  if (options?.admin && !isOrgAdmin(membership.role as OrgRole)) {
    return { response: jsonError(403, "Forbidden") };
  }

  return { ctx: { user, org, membership } };
}
