import { randomBytes } from "crypto";
import { apiUser, error, orgAccess } from "@/lib/api-auth";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await apiUser(); if (!user) return error(401, "Unauthorized");
  const { orgId } = await params;
  if (await orgAccess(orgId, user.id) !== "org_admin") return await orgAccess(orgId, user.id) ? error(403, "Forbidden") : error(404, "Not found");
  const body = await request.json().catch(() => null) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body?.role === "org_admin" || body?.role === "org_member" ? body.role : null;
  if (!email || !email.includes("@") || !role) return error(400, "A valid email and role are required");
  const token = randomBytes(32).toString("hex");
  const rows = await sql`
    WITH invite AS (
      INSERT INTO organization_invites (org_id, email, role, token) VALUES (${orgId}::uuid, ${email}, ${role}, ${token})
      RETURNING id, email, role, token, status
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT ${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'member.invited', email FROM invite
    ) SELECT id, email, role, token, status FROM invite
  ` as unknown as { id: string; email: string; role: string; token: string; status: string }[];
  return Response.json(rows[0], { status: 201 });
}
