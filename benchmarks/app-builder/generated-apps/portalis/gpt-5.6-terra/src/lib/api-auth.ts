import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export type ApiUser = { id: string; email: string; name: string };
export type OrgRole = "org_admin" | "org_member";

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function apiUser(): Promise<ApiUser | null> {
  const { data: session } = await auth.getSession();
  return session?.user ? { id: session.user.id, email: session.user.email, name: session.user.name } : null;
}

export async function orgAccess(orgId: string, userId: string): Promise<OrgRole | null> {
  if (!isUuid(orgId)) return null;
  const rows = await sql`SELECT role FROM organization_memberships WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid` as unknown as { role: OrgRole }[];
  return rows[0]?.role ?? null;
}

export function error(status: number, message: string) {
  return Response.json({ error: message }, { status });
}
