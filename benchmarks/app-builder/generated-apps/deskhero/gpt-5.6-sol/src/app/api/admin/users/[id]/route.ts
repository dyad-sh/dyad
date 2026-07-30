import { z } from "zod";

import { sql } from "@/db";
import { getCurrentUser, roles, type Role } from "@/lib/auth/current-user";
import type { DeskheroUser } from "@/lib/tickets";

const bodySchema = z.object({ role: z.enum(roles).optional(), active: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, "No changes provided");
type RouteContext = { params: Promise<{ id: string }> };
type Profile = { role: Role; active: boolean };

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });
  if (id === user.id && (parsed.data.role !== undefined || parsed.data.active === false)) {
    return Response.json({ error: "You cannot change your own role or deactivate yourself" }, { status: 403 });
  }

  const profiles = (await sql`SELECT role, active FROM user_profiles WHERE user_id = ${id}`) as Profile[];
  const current = profiles[0];
  if (!current) return Response.json({ error: "User not found" }, { status: 404 });
  const nextRole = parsed.data.role ?? current.role;
  const nextActive = parsed.data.active ?? current.active;

  await sql`UPDATE user_profiles SET role = ${nextRole}, active = ${nextActive} WHERE user_id = ${id}`;
  if (nextRole !== "agent" || !nextActive) await sql`UPDATE tickets SET assignee_id = NULL WHERE assignee_id = ${id}`;

  if (nextRole !== current.role) {
    await sql`
      INSERT INTO audit_events (actor_id, event_type, target_type, target_id, detail)
      VALUES (${user.id}, 'role_change', 'user', ${id}, ${`${current.role} → ${nextRole}`})
    `;
  }
  if (nextActive !== current.active) {
    const oldState = current.active ? "active" : "deactivated";
    const newState = nextActive ? "active" : "deactivated";
    await sql`
      INSERT INTO audit_events (actor_id, event_type, target_type, target_id, detail)
      VALUES (${user.id}, 'activation_change', 'user', ${id}, ${`${oldState} → ${newState}`})
    `;
  }

  const updated = (await sql`
    SELECT users.id, users.name, users.email, profiles.role, profiles.active
    FROM neon_auth."user" users JOIN user_profiles profiles ON profiles.user_id = users.id
    WHERE users.id = ${id}
  `) as DeskheroUser[];
  return Response.json(updated[0]);
}
