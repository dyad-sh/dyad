import { requireUser } from "@/lib/current-user";
import { recordAuditEvent } from "@/lib/audit";
import { sql } from "@/db";

const VALID_ROLES = ["admin", "agent", "requester"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const admin = auth.user;
  if (admin.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const [existing] = await sql`
    SELECT id, email, role, active FROM app_users WHERE id = ${id}
  `;
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);

  if (body?.role !== undefined && !VALID_ROLES.includes(body.role)) {
    return Response.json({ error: "Invalid role" }, { status: 400 });
  }
  if (body?.active !== undefined && typeof body.active !== "boolean") {
    return Response.json({ error: "Invalid active value" }, { status: 400 });
  }
  if (body?.active === false && id === admin.id) {
    return Response.json(
      { error: "Admins cannot deactivate themselves" },
      { status: 403 },
    );
  }

  const newRole = body?.role !== undefined ? body.role : existing.role;
  const newActive = body?.active !== undefined ? body.active : existing.active;

  const [updated] = await sql`
    UPDATE app_users SET role = ${newRole}, active = ${newActive}
    WHERE id = ${id}
    RETURNING id, name, email, role, active
  `;

  if (newRole !== existing.role) {
    await recordAuditEvent({
      actorId: admin.id,
      actorEmail: admin.email,
      eventType: "role_change",
      targetLabel: existing.email,
      detail: `${existing.role} -> ${newRole}`,
    });
  }
  if (newActive !== existing.active) {
    await recordAuditEvent({
      actorId: admin.id,
      actorEmail: admin.email,
      eventType: "activation_change",
      targetLabel: existing.email,
      detail: `${existing.active ? "active" : "inactive"} -> ${newActive ? "active" : "inactive"}`,
    });
  }

  return Response.json(updated);
}
