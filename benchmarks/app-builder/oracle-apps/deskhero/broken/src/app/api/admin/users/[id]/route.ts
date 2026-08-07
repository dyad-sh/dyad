import { sql } from "@/db";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser, Role } from "@/lib/current-user";

const roles = ["admin", "agent", "requester"] as const;
type RouteContext = { params: Promise<{ id: string }> };

// ORACLE-DEFECT D2: m3-p-self-promote, m3-p-agent-deactivate, m3-p-admin-self-deactivate
// Two guards deleted from the user-mutation route:
//   1. `actor.role !== "admin"` — the only thing stopping a requester from
//      PATCHing itself to `{"role":"admin"}` or an agent from deactivating a
//      requester. /admin/users is still admin-gated by the page guard and
//      GET /api/admin/users is still admin-only, so the UI is unchanged: the
//      hole exists purely at the HTTP layer, which is the classic
//      "authorization lives in the UI" failure this app is built to detect.
//   2. `id === actor.id` — the self-mutation guard, so an admin can lock
//      itself out (and, combined with 1, anyone can escalate themselves).
export async function PATCH(request: Request, { params }: RouteContext) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
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
