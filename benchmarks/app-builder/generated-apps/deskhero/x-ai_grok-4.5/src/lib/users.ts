import { sql } from "@/db";
import {
  defaultRoleForEmail,
  isRole,
  type Role,
} from "@/lib/roles";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
};

export type UserProfile = {
  role: Role;
  active: boolean;
};

export async function ensureUserProfile(options: {
  id: string;
  email: string;
  name?: string | null;
}): Promise<UserProfile> {
  const existing = await sql`
    SELECT role, active FROM user_profiles WHERE user_id = ${options.id} LIMIT 1
  `;

  if (existing.length > 0) {
    const role = existing[0].role;
    return {
      role: isRole(role) ? role : "requester",
      active: existing[0].active !== false,
    };
  }

  const role = defaultRoleForEmail(options.email);
  await sql`
    INSERT INTO user_profiles (user_id, role, active)
    VALUES (${options.id}, ${role}, true)
    ON CONFLICT (user_id) DO NOTHING
  `;

  const created = await sql`
    SELECT role, active FROM user_profiles WHERE user_id = ${options.id} LIMIT 1
  `;
  const createdRole = created[0]?.role;
  return {
    role: isRole(createdRole) ? createdRole : role,
    active: created[0]?.active !== false,
  };
}

export async function getUserRole(userId: string): Promise<Role | null> {
  const rows = await sql`
    SELECT role FROM user_profiles WHERE user_id = ${userId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const role = rows[0].role;
  return isRole(role) ? role : null;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const rows = await sql`
    SELECT role, active FROM user_profiles WHERE user_id = ${userId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const role = rows[0].role;
  return {
    role: isRole(role) ? role : "requester",
    active: rows[0].active !== false,
  };
}

export async function listAppUsers(): Promise<AppUser[]> {
  const rows = await sql`
    SELECT
      u.id,
      u.email,
      u.name,
      COALESCE(p.role, 'requester') AS role,
      COALESCE(p.active, true) AS active
    FROM neon_auth."user" u
    LEFT JOIN user_profiles p ON p.user_id = u.id
    ORDER BY u.created_at DESC
  `;

  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.email ?? ""),
    name: String(row.name ?? ""),
    role: isRole(row.role) ? row.role : "requester",
    active: row.active !== false,
  }));
}

export async function listAgents(): Promise<AppUser[]> {
  const users = await listAppUsers();
  return users.filter(
    (user) =>
      user.active && (user.role === "agent" || user.role === "admin"),
  );
}

export async function setUserRole(
  userId: string,
  role: Role,
): Promise<{ user: AppUser; previousRole: Role } | null> {
  const users = await sql`
    SELECT id, email, name FROM neon_auth."user" WHERE id = ${userId} LIMIT 1
  `;
  if (users.length === 0) {
    return null;
  }

  const existing = await getUserProfile(userId);
  const previousRole = existing?.role ?? "requester";
  const active = existing?.active ?? true;

  await sql`
    INSERT INTO user_profiles (user_id, role, active, updated_at)
    VALUES (${userId}, ${role}, ${active}, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET role = EXCLUDED.role,
          updated_at = NOW()
  `;

  const user = users[0];
  return {
    previousRole,
    user: {
      id: String(user.id),
      email: String(user.email ?? ""),
      name: String(user.name ?? ""),
      role,
      active,
    },
  };
}

export async function setUserActive(
  userId: string,
  active: boolean,
): Promise<{ user: AppUser; previousActive: boolean } | null> {
  const users = await sql`
    SELECT id, email, name FROM neon_auth."user" WHERE id = ${userId} LIMIT 1
  `;
  if (users.length === 0) {
    return null;
  }

  const existing = await getUserProfile(userId);
  const role = existing?.role ?? "requester";
  const previousActive = existing?.active ?? true;

  await sql`
    INSERT INTO user_profiles (user_id, role, active, updated_at)
    VALUES (${userId}, ${role}, ${active}, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET active = EXCLUDED.active,
          updated_at = NOW()
  `;

  const user = users[0];
  return {
    previousActive,
    user: {
      id: String(user.id),
      email: String(user.email ?? ""),
      name: String(user.name ?? ""),
      role,
      active,
    },
  };
}

export async function getAuthUserById(
  userId: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const rows = await sql`
    SELECT id, email, name FROM neon_auth."user" WHERE id = ${userId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return {
    id: String(rows[0].id),
    email: String(rows[0].email ?? ""),
    name: String(rows[0].name ?? ""),
  };
}
