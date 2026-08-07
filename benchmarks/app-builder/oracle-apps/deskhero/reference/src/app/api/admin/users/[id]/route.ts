import { sql } from "@/db";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser, Role } from "@/lib/current-user";

const roles = ["admin", "agent", "requester"] as const;
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (actor.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (id === actor.id) return Response.json({ error: "You cannot change your own account." }, { status: 403 });
  const input = await request.json().catch(() => null) as { role?: unknown; active?: unknown } | null;
  if (input?.role !== undefined && !roles.includes(input.role as Role)) return Response.json({ error: "Choose a valid role." }, { status: 422 });
  if (input?.active !== undefined && typeof input.active !== "boolean") return Response.json({ error: "Choose a valid account state." }, { status: 422 });
  if (input?.role === undefined && input?.active === undefined) return Response.json({ error: "Provide a role or account state." }, { status: 422 });
  const [before] = await sql`SELECT user_id, role, active FROM user_profiles WHERE user_id = ${id}`;
  if (!before) return Response.json({ error: "Not found" }, { status: 404 });
  const role = input?.role === undefined ? before.role : input.role as string;
  const active = input?.active === undefined ? before.active : input.active as boolean;
  const [updated] = await sql`UPDATE user_profiles SET role = ${role}, active = ${active} WHERE user_id = ${id} RETURNING user_id AS id, name, email, role, active`;
  if (role !== before.role) await recordAudit({ actorId: actor.id, eventType: "role_change", targetUserId: id, detail: `${before.role} → ${role}` });
  if (active !== before.active) await recordAudit({ actorId: actor.id, eventType: "activation_change", targetUserId: id, detail: `${before.active ? "active" : "deactivated"} → ${active ? "active" : "deactivated"}` });
  return Response.json(updated);
}
