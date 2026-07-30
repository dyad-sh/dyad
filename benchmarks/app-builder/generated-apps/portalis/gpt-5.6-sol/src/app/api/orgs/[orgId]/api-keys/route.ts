import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { sql } from "@/db";
import { authorizeOrganization } from "@/lib/api-authorization";

const schema = z.object({ name: z.string().trim().min(1).max(120) });

type Context = { params: Promise<{ orgId: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: Context) {
  const { orgId } = await params; const access = await authorizeOrganization(orgId, true); if (access instanceof Response) return access;
  const keys = await sql`SELECT id, name, prefix, status FROM api_keys WHERE organization_id = ${orgId}::uuid ORDER BY created_at DESC`;
  return Response.json(keys);
}

export async function POST(request: Request, { params }: Context) {
  const { orgId } = await params; const access = await authorizeOrganization(orgId, true); if (access instanceof Response) return access;
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: "Enter a valid key name." }, { status: 400 });
  const key = `ptl_${randomBytes(32).toString("base64url")}`;
  const prefix = key.slice(0, 12);
  const hash = createHash("sha256").update(key).digest("hex");
  const rows = await sql`
    WITH created AS (
      INSERT INTO api_keys (organization_id, name, prefix, key_hash, created_by)
      VALUES (${orgId}::uuid, ${parsed.data.name}, ${prefix}, ${hash}, ${access.user.id}::uuid)
      RETURNING id, organization_id, name, prefix
    ), audit AS (
      INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
      SELECT organization_id, ${access.user.id}::uuid, ${access.user.email}, 'apikey.created', 'apikey:' || id::text FROM created
    )
    SELECT id, name, prefix FROM created
  `;
  return Response.json({ ...rows[0], key }, { status: 201 });
}
