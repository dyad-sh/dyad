import "server-only";

import { sql } from "@/db";
import { uuidPattern, type OrganizationRole } from "@/lib/organizations";
import { getCurrentUser, type CurrentUser } from "@/lib/session";

type AuthorizedOrganization = { user: CurrentUser; role: OrganizationRole };

export async function authorizeOrganization(
  orgId: string,
  adminOnly = false,
): Promise<AuthorizedOrganization | Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!uuidPattern.test(orgId)) return Response.json({ error: "Not found" }, { status: 404 });

  const rows = await sql`
    SELECT role FROM organization_memberships
    WHERE organization_id = ${orgId}::uuid AND user_id = ${user.id}::uuid
    LIMIT 1
  `;
  const membership = rows[0] as { role: OrganizationRole } | undefined;
  if (!membership) return Response.json({ error: "Not found" }, { status: 404 });
  if (adminOnly && membership.role !== "org_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return { user, role: membership.role };
}
