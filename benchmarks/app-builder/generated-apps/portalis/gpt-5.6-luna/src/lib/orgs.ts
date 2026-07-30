import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export type CurrentUser = { id: string; email: string; name: string };

export async function requireUser(): Promise<CurrentUser> {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export async function getMemberOrg(orgId: string, userId: string) {
  const rows = await sql`
    SELECT o.id, o.name, o.slug, o.description, m.role
    FROM organizations o

    INNER JOIN organization_members m ON m.organization_id = o.id
    WHERE o.id = ${orgId}::uuid AND m.user_id = ${userId}::uuid
    LIMIT 1
  `;
  return rows[0] as { id: string; name: string; slug: string; description: string; role: "org_admin" | "org_member" } | undefined;
}
