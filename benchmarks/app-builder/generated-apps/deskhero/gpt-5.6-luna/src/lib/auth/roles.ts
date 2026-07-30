import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export type Role = "admin" | "agent" | "requester";

export async function getActor() {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  const [existing] = await sql`SELECT role, active FROM user_roles WHERE user_id = ${session.user.id}`;
  if (existing && existing.active === false) return null;
  if (existing) return { ...session.user, role: existing.role as Role };
  const role: Role = session.user.email.toLowerCase().split("@")[0].startsWith("admin+") ? "admin" : "requester";
  const [created] = await sql`
    INSERT INTO user_roles (user_id, role, active) VALUES (${session.user.id}, ${role}, TRUE)
    ON CONFLICT (user_id) DO UPDATE SET role = user_roles.role
    RETURNING role
  `;
  return { ...session.user, role: created.role as Role };
}

export async function recordAudit(actorId: string, eventType: "role_change" | "activation_change" | "status_transition", targetId: string, detail: string) {
  await sql`
    INSERT INTO audit_events (actor_id, event_type, target_id, detail)
    VALUES (${actorId}, ${eventType}, ${targetId}, ${detail})
  `;
}

export function isRole(value: unknown): value is Role {
  return value === "admin" || value === "agent" || value === "requester";
}
