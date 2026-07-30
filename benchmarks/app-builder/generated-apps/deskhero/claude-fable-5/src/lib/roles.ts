import { sql } from "@/db";
import { auth } from "@/lib/auth/server";
import type { Role } from "@/lib/tickets";

export function defaultRoleForEmail(email: string): Role {
  const localPart = email.split("@")[0];
  return localPart.startsWith("admin+") ? "admin" : "requester";
}

async function loadRoleRow(user: {
  id: string;
  email: string;
}): Promise<{ role: Role; active: boolean }> {
  const [row] = await sql`
    SELECT role, active FROM user_roles WHERE user_id = ${user.id}
  `;
  if (row) return { role: row.role as Role, active: row.active as boolean };
  const role = defaultRoleForEmail(user.email);
  await sql`
    INSERT INTO user_roles (user_id, role)
    VALUES (${user.id}, ${role})
    ON CONFLICT (user_id) DO NOTHING
  `;
  return { role, active: true };
}

export type SessionContext = {
  user: { id: string; email: string; name: string };
  role: Role;
  active: boolean;
};

export async function getSessionWithRole(): Promise<SessionContext | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  const { role, active } = await loadRoleRow(session.user);
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    },
    role,
    active,
  };
}

type ApiAuth =
  | { ctx: SessionContext; response: null }
  | { ctx: null; response: Response };

/** For API routes: 401 when unauthenticated, 403 when the account is deactivated. */
export async function requireActiveUser(): Promise<ApiAuth> {
  const ctx = await getSessionWithRole();
  if (!ctx) {
    return {
      ctx: null,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!ctx.active) {
    return {
      ctx: null,
      response: Response.json(
        { error: "Account deactivated" },
        { status: 403 },
      ),
    };
  }
  return { ctx, response: null };
}

/** Effective role of any user, applying the admin+ email bootstrap default. */
export async function effectiveRoleOf(userId: string): Promise<Role | null> {
  const [row] = await sql`
    SELECT COALESCE(
      r.role,
      CASE WHEN split_part(u.email, '@', 1) LIKE 'admin+%'
        THEN 'admin' ELSE 'requester' END
    ) AS role
    FROM neon_auth.users u
    LEFT JOIN user_roles r ON r.user_id = u.id
    WHERE u.id = ${userId}
  `;
  return (row?.role as Role) ?? null;
}
