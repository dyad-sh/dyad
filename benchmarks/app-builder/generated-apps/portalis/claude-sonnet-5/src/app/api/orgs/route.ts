import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";
import { isValidSlug } from "@/lib/orgs";
import { auditLogInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const slug =
    typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const description =
    typeof body?.description === "string" && body.description.trim() !== ""
      ? body.description.trim()
      : null;

  if (!name) {
    return NextResponse.json(
      { error: "Organization name is required." },
      { status: 400 },
    );
  }

  if (!slug || !isValidSlug(slug)) {
    return NextResponse.json(
      {
        error:
          "Slug must contain only lowercase letters, numbers, and hyphens.",
      },
      { status: 400 },
    );
  }

  const orgId = randomUUID();

  try {
    await sql.transaction([
      sql`INSERT INTO organizations (id, name, slug, description) VALUES (${orgId}, ${name}, ${slug}, ${description})`,
      sql`INSERT INTO org_members (org_id, user_id, role) VALUES (${orgId}, ${session.user.id}, 'org_admin')`,
      auditLogInsert(orgId, session.user.id, "org.created", name),
    ]);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { error: "That slug is already taken." },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json({ id: orgId, name, slug }, { status: 201 });
}
