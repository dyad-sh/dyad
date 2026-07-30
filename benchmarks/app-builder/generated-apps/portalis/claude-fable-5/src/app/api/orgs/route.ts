import { randomUUID } from "crypto";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";
import { SLUG_RE } from "@/lib/orgs";

export async function POST(req: Request) {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

  if (!name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }
  if (!SLUG_RE.test(slug)) {
    return Response.json(
      {
        error:
          "Slug must be lowercase letters, numbers, and hyphens (e.g. acme-inc).",
      },
      { status: 400 },
    );
  }

  const existing = await sql`SELECT 1 FROM organizations WHERE slug = ${slug}`;
  if (existing.length > 0) {
    return Response.json(
      { error: "That slug is already taken." },
      { status: 409 },
    );
  }

  const orgId = randomUUID();
  try {
    await sql.transaction((tx) => [
      tx`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, ${name}, ${slug})`,
      tx`INSERT INTO memberships (org_id, user_id, role) VALUES (${orgId}, ${session.user.id}, 'org_admin')`,
      tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${orgId}, ${session.user.email}, 'org.created', ${name})`,
    ]);
  } catch {
    return Response.json(
      { error: "That slug is already taken." },
      { status: 409 },
    );
  }

  return Response.json({ id: orgId, name, slug }, { status: 201 });
}
