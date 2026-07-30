import { z } from "zod";
import { sql } from "@/db";
import { authorizeOrganization } from "@/lib/api-authorization";
import { uuidPattern } from "@/lib/organizations";

const schema = z.object({ role: z.enum(["org_admin", "org_member"]) });
type Context = { params: Promise<{ orgId: string; userId: string }> };

async function getScopedAccess(orgId: string, userId: string) {
  const access = await authorizeOrganization(orgId); if (access instanceof Response) return access;
  if (!uuidPattern.test(userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const target = await sql`SELECT 1 FROM organization_memberships WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid`;
  if (!target[0]) return Response.json({ error: "Not found" }, { status: 404 });
  if (access.role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  return access;
}

export async function PATCH(request: Request, { params }: Context) {
  const { orgId, userId } = await params; const access = await getScopedAccess(orgId, userId); if (access instanceof Response) return access;
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: "Invalid role." }, { status: 400 });
  const rows = await sql`
    WITH changed AS (
      UPDATE organization_memberships SET role = ${parsed.data.role}
      WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid RETURNING user_id, organization_id, role
    ), audit AS (
      INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
      SELECT organization_id, ${access.user.id}::uuid, ${access.user.email}, 'member.role_changed', 'member:' || user_id::text FROM changed
    )
    SELECT user_id, role FROM changed
  `;
  return Response.json(rows[0]);
}

export async function DELETE(_request: Request, { params }: Context) {
  const { orgId, userId } = await params; const access = await getScopedAccess(orgId, userId); if (access instanceof Response) return access;
  const rows = await sql`
    WITH removed AS (
      DELETE FROM organization_memberships WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid RETURNING user_id, organization_id
    ), audit AS (
      INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
      SELECT organization_id, ${access.user.id}::uuid, ${access.user.email}, 'member.removed', 'member:' || user_id::text FROM removed
    )
    SELECT user_id FROM removed
  `;
  if (!rows[0]) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ removed: true });
}
