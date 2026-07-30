import { randomUUID } from "crypto";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: session } = await auth.getSession(); if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await sql`SELECT o.id, o.name, o.slug FROM organizations o INNER JOIN organization_members m ON m.organization_id = o.id WHERE m.user_id = ${session.user.id}::uuid ORDER BY o.created_at DESC`;
  return Response.json(rows);
}

export async function POST(request: Request) {
  const { data: session } = await auth.getSession(); if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { name?: string; slug?: string }; const name = body.name?.trim(); const slug = body.slug?.trim().toLowerCase();
  if (!name || !slug || !/^[a-z0-9-]+$/.test(slug)) return Response.json({ error: "Enter a name and a valid lowercase slug." }, { status: 400 });
  const id = randomUUID();
  try { await sql.transaction([sql`INSERT INTO organizations (id, name, slug) VALUES (${id}::uuid, ${name}, ${slug})`, sql`INSERT INTO organization_members (organization_id, user_id, user_email, role) VALUES (${id}::uuid, ${session.user.id}::uuid, ${session.user.email}, 'org_admin')`, sql`INSERT INTO audit_logs (organization_id, actor_user_id, actor_email, action, target) VALUES (${id}::uuid, ${session.user.id}::uuid, ${session.user.email}, 'org.created', ${id})`]); return Response.json({ id }, { status: 201 }); }
  catch (error) { const message = error instanceof Error && error.message.includes("organizations_slug_key") ? "That slug is already in use." : "Unable to create organization."; return Response.json({ error: message }, { status: 400 }); }
}
