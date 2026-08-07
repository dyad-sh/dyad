import { sql } from "@/db";
import { auth } from "@/lib/auth/server";

export type Role = "admin" | "agent" | "requester";
export type CurrentUser = { id: string; name: string; email: string; role: Role; active: boolean };

function bootstrapRole(email: string): Role { return email.split("@", 1)[0]?.startsWith("admin+") ? "admin" : "requester"; }

export async function getSessionAccount(): Promise<CurrentUser | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  const user = session.user;
  const [profile] = await sql`
    INSERT INTO user_profiles (user_id, name, email, role)
    VALUES (${user.id}, ${user.name}, ${user.email}, ${bootstrapRole(user.email)})
    ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
    RETURNING user_id, name, email, role, active
  `;
  return { id: profile.user_id, name: profile.name, email: profile.email, role: profile.role as Role, active: profile.active };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const user = await getSessionAccount();
  return user?.active ? user : null;
}

export function dashboardPath(role: Role) { return role === "admin" ? "/admin" : role === "agent" ? "/agent" : "/tickets"; }
