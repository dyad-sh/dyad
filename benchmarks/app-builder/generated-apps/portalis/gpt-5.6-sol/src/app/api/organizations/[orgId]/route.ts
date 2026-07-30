import { z } from "zod";
import { sql } from "@/db";
import { authorizeOrganization } from "@/lib/api-authorization";

const schema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000) });

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await authorizeOrganization(orgId, true);
  if (access instanceof Response) return access;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Enter a valid organization profile." }, { status: 400 });
  await sql`
    WITH changed AS (
      UPDATE organizations SET name = ${parsed.data.name}, description = ${parsed.data.description}, updated_at = now()
      WHERE id = ${orgId}::uuid RETURNING id
    ), audit AS (
      INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
      SELECT id, ${access.user.id}::uuid, ${access.user.email}, 'org.updated', 'organization:' || id::text FROM changed
    )
    SELECT id FROM changed
  `;
  return Response.json({ ok: true });
}
