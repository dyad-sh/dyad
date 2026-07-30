import { z } from "zod";
import { sql } from "@/db";
import { getCurrentUser } from "@/lib/session";

const schema = z.object({ name: z.string().trim().min(1).max(120), slug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Use a name and a lowercase slug with letters, numbers, or hyphens." }, { status: 400 });
  try {
    const rows = await sql`
      WITH new_org AS (
        INSERT INTO organizations (name, slug) VALUES (${parsed.data.name}, ${parsed.data.slug}) RETURNING id
      ), new_membership AS (
        INSERT INTO organization_memberships (organization_id, user_id, role)
        SELECT id, ${user.id}::uuid, 'org_admin' FROM new_org RETURNING organization_id
      ), audit AS (
        INSERT INTO audit_events (organization_id, actor_user_id, actor_email, action, target)
        SELECT id, ${user.id}::uuid, ${user.email}, 'org.created', 'organization:' || id::text FROM new_org
      )
      SELECT id FROM new_org
    `;
    return Response.json({ id: rows[0].id }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("organizations_slug_key")) return Response.json({ error: "That slug is already in use." }, { status: 409 });
    return Response.json({ error: "Unable to create the organization." }, { status: 500 });
  }
}
