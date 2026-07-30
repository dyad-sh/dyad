import { sql } from "@/db";
import {
  authorize,
  badRequest,
  forbidden,
  notFound,
} from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { isRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  const { user } = gate;
  if (user.role !== "admin") return forbidden("Admins only");

  const { id } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const data = (payload ?? {}) as Record<string, unknown>;

  const target = (await sql`
    SELECT u.id, u.name, u.email,
           COALESCE(p.role, 'requester') AS role,
           COALESCE(p.active, true) AS active
    FROM neon_auth."user" u
    LEFT JOIN user_profiles p ON p.user_id = u.id
    WHERE u.id = ${id}
  `) as {
    id: string;
    name: string | null;
    email: string;
    role: string;
    active: boolean;
  }[];

  const existing = target[0];
  if (!existing) return notFound();

  let role = existing.role;
  if (data.role !== undefined) {
    if (!isRole(data.role)) return badRequest("Invalid role");
    role = data.role;
  }

  let active = existing.active;
  if (data.active !== undefined) {
    if (typeof data.active !== "boolean") return badRequest("Invalid active");
    if (id === user.id && data.active === false) {
      return forbidden("You cannot deactivate your own account.");
    }
    active = data.active;
  }

  await sql`
    INSERT INTO user_profiles (user_id, role, active)
    VALUES (${id}, ${role}, ${active})
    ON CONFLICT (user_id) DO UPDATE SET role = ${role}, active = ${active}
  `;

  if (role !== existing.role) {
    await logAudit({
      actorId: user.id,
      eventType: "role_change",
      targetUserId: id,
      oldValue: existing.role,
      newValue: role,
    });
  }

  if (active !== existing.active) {
    await logAudit({
      actorId: user.id,
      eventType: "activation_change",
      targetUserId: id,
      oldValue: existing.active ? "active" : "deactivated",
      newValue: active ? "active" : "deactivated",
    });
  }

  return Response.json({
    id: existing.id,
    name: existing.name,
    email: existing.email,
    role,
    active,
  });
}
