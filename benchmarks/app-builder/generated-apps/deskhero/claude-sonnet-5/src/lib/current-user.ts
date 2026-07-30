import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export type Role = "admin" | "agent" | "requester";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
};

function defaultRoleForEmail(email: string): Role {
  const localPart = email.split("@")[0] ?? "";
  return localPart.startsWith("admin+") ? "admin" : "requester";
}

/**
 * Resolves the signed-in caller and ensures a corresponding row exists in
 * app_users (created lazily on first authenticated request, with the role
 * determined by the bootstrap rule).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return null;
  }

  const { id, email, name } = session.user;

  const [existing] = await sql`
    SELECT role, active FROM app_users WHERE id = ${id}
  `;

  if (existing) {
    await sql`UPDATE app_users SET email = ${email}, name = ${name} WHERE id = ${id}`;
    return {
      id,
      email,
      name,
      role: existing.role as Role,
      active: existing.active as boolean,
    };
  }

  const role = defaultRoleForEmail(email);
  await sql`
    INSERT INTO app_users (id, email, name, role)
    VALUES (${id}, ${email}, ${name}, ${role})
    ON CONFLICT (id) DO NOTHING
  `;
  return { id, email, name, role, active: true };
}

export type AuthResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Resolves the signed-in caller and rejects immediately if the session is
 * missing or the account has been deactivated, regardless of route.
 */
export async function requireUser(): Promise<AuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!user.active) {
    return { ok: false, status: 403, error: "Account deactivated" };
  }
  return { ok: true, user };
}
