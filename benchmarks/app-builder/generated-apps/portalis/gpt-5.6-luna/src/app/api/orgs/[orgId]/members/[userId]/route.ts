import { sql } from "@/db";
import { getApiUser, getOrgRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string; userId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId, userId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 }); if (role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 }); if (!/^[0-9a-f-]{36}$/i.test(userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const target = await sql`SELECT id, role AS current_role FROM organization_members WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid LIMIT 1`; if (!target.length) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await request.json() as { role?: string }; if (!body.role || !["org_admin", "org_member"].includes(body.role)) return Response.json({ error: "Invalid role" }, { status: 400 });
  await sql.transaction([sql`UPDATE organization_members SET role = ${body.role} WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'member.role_changed', ${userId})`]); return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ orgId: string; userId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId, userId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 }); if (role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 }); if (!/^[0-9a-f-]{36}$/i.test(userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const target = await sql`SELECT id FROM organization_members WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid LIMIT 1`; if (!target.length) return Response.json({ error: "Not found" }, { status: 404 });
  await sql.transaction([sql`DELETE FROM organization_members WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'member.removed', ${userId})`]); return new Response(null, { status: 204 });
}
