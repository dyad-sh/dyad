import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export type ApiUser = { id: string; email: string; name: string };

export async function getApiUser(): Promise<ApiUser | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export async function getOrgRole(orgId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return undefined;
  const rows = await sql`SELECT role FROM organization_members WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid LIMIT 1`;
  return rows[0]?.role as "org_admin" | "org_member" | undefined;
}
