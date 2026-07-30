import { apiUser, error, isUuid, orgAccess } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

async function adminAccess(params: Promise<{ orgId: string; userId: string }>) {
  const caller = await apiUser(); if (!caller) return { response: error(401, "Unauthorized") };
  const values = await params; const role = await orgAccess(values.orgId, caller.id);
  if (!role || !isUuid(values.userId)) return { response: error(404, "Not found") };
  if (role !== "org_admin") return { response: error(403, "Forbidden") };
  return { caller, ...values };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string; userId: string }> }) {
  const result = await adminAccess(params); if ("response" in result) return result.response;
  const body = await request.json().catch(() => null) as { role?: unknown } | null;
  if (body?.role !== "org_admin" && body?.role !== "org_member") return error(400, "Invalid role");
  const rows = await sql`
    WITH membership AS (
      UPDATE organization_memberships SET role = ${body.role} WHERE org_id = ${result.orgId}::uuid AND user_id = ${result.userId}::uuid
      RETURNING user_id
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT ${result.orgId}::uuid, ${result.caller.id}::uuid, ${result.caller.email}, 'member.role_changed', user_id::text FROM membership
    ) SELECT user_id FROM membership
  ` as unknown as { user_id: string }[];
  if (!rows[0]) return error(404, "Not found");
  return Response.json({ updated: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ orgId: string; userId: string }> }) {
  const result = await adminAccess(params); if ("response" in result) return result.response;
  const rows = await sql`
    WITH membership AS (
      DELETE FROM organization_memberships WHERE org_id = ${result.orgId}::uuid AND user_id = ${result.userId}::uuid RETURNING user_id
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT ${result.orgId}::uuid, ${result.caller.id}::uuid, ${result.caller.email}, 'member.removed', user_id::text FROM membership
    ) SELECT user_id FROM membership
  ` as unknown as { user_id: string }[];
  if (!rows[0]) return error(404, "Not found");
  return Response.json({ deleted: true });
}
