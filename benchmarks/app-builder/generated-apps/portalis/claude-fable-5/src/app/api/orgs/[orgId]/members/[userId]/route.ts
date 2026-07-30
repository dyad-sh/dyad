import { sql } from "@/db";
import { requireOrgMember, forbidNonAdmin } from "@/lib/guard";
import { ROLES } from "@/lib/orgs";

async function findMembership(orgId: string, userId: string) {
  const rows = await sql`
    SELECT m.id, m.user_id, m.role, u.email
    FROM memberships m
    JOIN neon_auth."user" u ON u.id = m.user_id
    WHERE m.org_id = ${orgId} AND m.user_id = ${userId}
  `;
  return (rows[0] as { id: string; role: string; email: string } | undefined) ?? null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  const { orgId, userId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const forbidden = forbidNonAdmin(guard.org);
  if (forbidden) return forbidden;

  const membership = await findMembership(guard.org.id, userId);
  if (!membership) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const role = typeof body?.role === "string" ? body.role : "";
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    return Response.json({ error: "Invalid role." }, { status: 400 });
  }

  await sql.transaction((tx) => [
    tx`
      UPDATE memberships SET role = ${role}
      WHERE org_id = ${guard.org.id} AND user_id = ${userId}
    `,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${guard.org.id}, ${guard.userEmail}, 'member.role_changed', ${`${membership.email} → ${role}`})`,
  ]);
  return Response.json({ userId, role });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  const { orgId, userId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const forbidden = forbidNonAdmin(guard.org);
  if (forbidden) return forbidden;

  const membership = await findMembership(guard.org.id, userId);
  if (!membership) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await sql.transaction((tx) => [
    tx`
      DELETE FROM memberships
      WHERE org_id = ${guard.org.id} AND user_id = ${userId}
    `,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${guard.org.id}, ${guard.userEmail}, 'member.removed', ${membership.email})`,
  ]);
  return Response.json({ ok: true });
}
