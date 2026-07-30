import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { data: session } = await auth.getSession(); if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = await params; const member = await sql`SELECT role FROM organization_members WHERE organization_id = ${orgId}::uuid AND user_id = ${session.user.id}::uuid LIMIT 1`;
  if (!member.length) return Response.json({ error: "Not found" }, { status: 404 }); if (member[0].role !== "org_admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json() as { name?: string; description?: string }; const name = body.name?.trim(); const description = body.description?.trim() ?? "";
  if (!name) return Response.json({ error: "Organization name is required." }, { status: 400 });
  await sql.transaction([sql`UPDATE organizations SET name = ${name}, description = ${description} WHERE id = ${orgId}::uuid`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${orgId}::uuid, ${session.user.id}::uuid, ${session.user.email}, 'org.updated', ${orgId})`]);
  return Response.json({ ok: true });
}
