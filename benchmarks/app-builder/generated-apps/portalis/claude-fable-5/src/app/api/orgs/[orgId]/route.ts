import { sql } from "@/db";
import { requireOrgMember, forbidNonAdmin } from "@/lib/guard";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const forbidden = forbidNonAdmin(guard.org);
  if (forbidden) return forbidden;

  const org = guard.org;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";

  if (!name) {
    return Response.json({ error: "Name is required." }, { status: 400 });
  }

  await sql.transaction((tx) => [
    tx`
      UPDATE organizations
      SET name = ${name}, description = ${description}
      WHERE id = ${org.id}
    `,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${org.id}, ${guard.userEmail}, 'org.updated', ${name})`,
  ]);

  return Response.json({ id: org.id, name, description });
}
