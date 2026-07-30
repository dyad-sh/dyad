import { randomBytes, randomUUID } from "crypto";
import { sql } from "@/db";
import { getApiUser, getOrgRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const user = await getApiUser(); if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = await params; const role = await getOrgRole(orgId, user.id); if (!role) return Response.json({ error: "Not found" }, { status: 404 }); if (role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json() as { email?: string; role?: string }; const email = body.email?.trim().toLowerCase(); const inviteRole = body.role;
  if (!email || !inviteRole || !["org_admin", "org_member"].includes(inviteRole)) return Response.json({ error: "Enter a valid email and role." }, { status: 400 });
  const token = randomBytes(32).toString("base64url"); const id = randomUUID();
  await sql.transaction([sql`INSERT INTO organization_invites (id, organization_id, invited_email, role, token, invited_by) VALUES (${id}::uuid, ${orgId}::uuid, ${email}, ${inviteRole}, ${token}, ${user.id}::uuid)`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${orgId}::uuid, ${user.id}::uuid, ${user.email}, 'member.invited', ${email})`]);
  const invite = { id, status: "pending", invited_email: email, role: inviteRole, token };
  return Response.json({ ...invite, link: new URL(`/invite/${token}`, request.url).toString() }, { status: 201 });
}
