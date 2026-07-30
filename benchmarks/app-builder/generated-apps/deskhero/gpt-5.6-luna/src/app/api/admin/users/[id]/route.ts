import { getActor, isRole, recordAudit } from "@/lib/auth/roles";
import { sql } from "@/db";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const id = (await params).id;
  if (id === user.id) return Response.json({ error: "You cannot change your own role or activation" }, { status: 403 });
  const [target] = await sql`SELECT u.id, COALESCE(r.role, 'requester') AS role, COALESCE(r.active, TRUE) AS active FROM neon_auth."user" u LEFT JOIN user_roles r ON r.user_id = u.id WHERE u.id = ${id}`;
  if (!target) return Response.json({ error: "User not found" }, { status: 404 });
  const payload = await request.json();
  const nextRole = payload.role === undefined ? target.role : payload.role;
  const nextActive = payload.active === undefined ? target.active : payload.active;
  if (!isRole(nextRole) || typeof nextActive !== "boolean") return Response.json({ error: "Invalid user change" }, { status: 400 });
  const [updated] = await sql`
    INSERT INTO user_roles (user_id, role, active) VALUES (${id}, ${nextRole}, ${nextActive})
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active
    RETURNING user_id, role, active
  `;
  if (nextRole !== target.role) await recordAudit(user.id, "role_change", id, `${target.role} → ${nextRole}`);
  if (nextActive !== target.active) await recordAudit(user.id, "activation_change", id, `${target.active ? "active" : "deactivated"} → ${nextActive ? "active" : "deactivated"}`);
  return Response.json(updated);
}
