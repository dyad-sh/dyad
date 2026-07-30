import { requireActiveUser, defaultRoleForEmail } from "@/lib/roles";
import { sql } from "@/db";
import { recordAudit } from "@/lib/audit";
import { ROLES } from "@/lib/tickets";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  if (ctx.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const data = (payload ?? {}) as Record<string, unknown>;

  const wantsRole = data.role !== undefined;
  const wantsActive = data.active !== undefined;
  if (!wantsRole && !wantsActive) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (
    wantsRole &&
    (typeof data.role !== "string" ||
      !(ROLES as readonly string[]).includes(data.role))
  ) {
    return Response.json({ error: "Invalid role" }, { status: 400 });
  }
  if (wantsActive && typeof data.active !== "boolean") {
    return Response.json({ error: "Invalid active value" }, { status: 400 });
  }
  if (id === ctx.user.id) {
    return Response.json(
      { error: "You cannot change your own role or activation state" },
      { status: 403 },
    );
  }

  const [target] = await sql`
    SELECT id, name, email FROM neon_auth.users WHERE id = ${id}
  `;
  if (!target) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const [existing] = await sql`
    SELECT role, active FROM user_roles WHERE user_id = ${id}
  `;
  const currentRole =
    (existing?.role as string) ?? defaultRoleForEmail(target.email as string);
  const currentActive = (existing?.active as boolean) ?? true;

  const newRole = wantsRole ? (data.role as string) : currentRole;
  const newActive = wantsActive ? (data.active as boolean) : currentActive;

  await sql`
    INSERT INTO user_roles (user_id, role, active)
    VALUES (${id}, ${newRole}, ${newActive})
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active
  `;

  if (wantsRole && newRole !== currentRole) {
    await recordAudit({
      actorId: ctx.user.id,
      eventType: "role_change",
      targetType: "user",
      targetId: id,
      detail: `${currentRole} → ${newRole}`,
    });
  }
  if (wantsActive && newActive !== currentActive) {
    await recordAudit({
      actorId: ctx.user.id,
      eventType: "activation_change",
      targetType: "user",
      targetId: id,
      detail: `${currentActive ? "active" : "deactivated"} → ${
        newActive ? "active" : "deactivated"
      }`,
    });
  }

  return Response.json({ ...target, role: newRole, active: newActive });
}
