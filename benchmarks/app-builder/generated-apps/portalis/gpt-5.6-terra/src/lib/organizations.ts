import { redirect } from "next/navigation";
import { sql } from "@/db";
import { auth } from "@/lib/auth/server";

export type SessionUser = { id: string; email: string; name: string };
export type Organization = { id: string; name: string; slug: string; description: string };
export type OrgRole = "org_admin" | "org_member";

export async function requireUser(): Promise<SessionUser> {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export async function requireOrgMember(orgId: string): Promise<{ user: SessionUser; organization: Organization | null; role: OrgRole | null }> {
  const user = await requireUser();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId)) return { user, organization: null, role: null };
  const organizations = await sql`
    SELECT o.id, o.name, o.slug, o.description, m.role
    FROM organizations o
    INNER JOIN organization_memberships m ON m.org_id = o.id
    WHERE o.id = ${orgId}::uuid AND m.user_id = ${user.id}::uuid
  ` as unknown as (Organization & { role: OrgRole })[];
  const record = organizations[0];
  return { user, organization: record ?? null, role: record?.role ?? null };
}
