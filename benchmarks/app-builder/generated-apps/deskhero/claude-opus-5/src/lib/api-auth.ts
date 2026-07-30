import { sql } from "@/db";
import { auth } from "@/lib/auth/server";
import { defaultRoleForEmail, isRole, type Role } from "@/lib/roles";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
};

/**
 * Returns the signed-in user (with their server-side role and active flag), or
 * null when the request is unauthenticated. The profile row is created on first
 * sight, applying the local-dev `admin+` bootstrap rule; it is never
 * overwritten afterwards, so users can't influence their own role.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user) return null;

  const rows = (await sql`
    INSERT INTO user_profiles (user_id, role)
    VALUES (${user.id}, ${defaultRoleForEmail(user.email)})
    ON CONFLICT (user_id) DO UPDATE SET user_id = user_profiles.user_id
    RETURNING role, active
  `) as { role: string; active: boolean }[];

  const role = isRole(rows[0]?.role) ? rows[0].role : "requester";

  return {
    id: user.id,
    email: user.email,
    name: user.name ?? "",
    role,
    active: rows[0]?.active !== false,
  };
}

export type Gate =
  | { ok: true; user: SessionUser }
  | { ok: false; response: Response };

/**
 * Single entry point for API routes: rejects unauthenticated callers with 401
 * and callers whose account has been deactivated with 403 — deactivation takes
 * effect immediately, even for sessions issued earlier.
 */
export async function authorize(): Promise<Gate> {
  const user = await getSessionUser();
  if (!user) return { ok: false, response: unauthorized() };
  if (!user.active) {
    return {
      ok: false,
      response: Response.json(
        { error: "Account deactivated", code: "account_deactivated" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, user };
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return Response.json({ error: message }, { status: 403 });
}

export function notFound() {
  return Response.json({ error: "Not found" }, { status: 404 });
}

export function unprocessable(message: string) {
  return Response.json({ error: message }, { status: 422 });
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}
