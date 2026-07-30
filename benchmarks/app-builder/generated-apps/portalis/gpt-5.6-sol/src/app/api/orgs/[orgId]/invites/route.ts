import { randomBytes } from "node:crypto";
import { z } from "zod";
import { sql } from "@/db";
import { authorizeOrganization } from "@/lib/api-authorization";

const schema = z.object({ email: z.string().email().transform((value) => value.trim().toLowerCase()), role: z.enum(["org_admin", "org_member"]) });

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params; const access = await authorizeOrganization(orgId, true); if (access instanceof Response) return access;
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: "Enter a valid email and role." }, { status: 400 });
  const existing = await sql`SELECT 1 FROM organization_memberships m JOIN app_users u ON u.id = m.user_id WHERE m.organization_id = ${orgId}::uuid AND lower(u.email) = ${parsed.data.email} LIMIT 1`;
  if (existing[0]) return Response.json({ error: "That user is already a member." }, { status: 409 });
  try {
    const token = randomBytes(32).toString("base64url");
    const rows = await sql`
      WITH created AS (
        INSERT INTO organization_invites (organization_id, email, role, token, invited_by)
        VALUES (${orgId}::uuid, ${parsed.data.email}, ${parsed.data.role}, ${token}, ${access.user.id}::uuid)
        RETURNING id, organization_id, email, role, token, status
      ), audit AS (
        INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
        SELECT organization_id, ${access.user.id}::uuid, ${access.user.email}, 'member.invited', 'invite:' || email FROM created
      )
      SELECT id, email, role, token, status FROM created
    `;
    return Response.json(rows[0], { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("organization_invites_pending_email_idx")) return Response.json({ error: "A pending invite already exists for that email." }, { status: 409 });
    return Response.json({ error: "Unable to create the invite." }, { status: 500 });
  }
}
