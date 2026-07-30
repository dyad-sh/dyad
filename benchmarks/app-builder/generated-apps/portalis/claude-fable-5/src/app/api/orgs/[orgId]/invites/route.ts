import { randomBytes, randomUUID } from "crypto";
import { sql } from "@/db";
import { requireOrgMember, forbidNonAdmin } from "@/lib/guard";
import { ROLES } from "@/lib/orgs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const guard = await requireOrgMember(orgId);
  if (!guard.ok) return guard.res;

  const forbidden = forbidNonAdmin(guard.org);
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => null);
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body?.role === "string" ? body.role : "";

  if (!email || !email.includes("@")) {
    return Response.json(
      { error: "A valid email is required." },
      { status: 400 },
    );
  }
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    return Response.json({ error: "Invalid role." }, { status: 400 });
  }

  const token = randomBytes(32).toString("base64url");
  const inviteId = randomUUID();
  await sql.transaction((tx) => [
    tx`
      INSERT INTO invites (id, org_id, email, role, token)
      VALUES (${inviteId}, ${guard.org.id}, ${email}, ${role}, ${token})
    `,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${guard.org.id}, ${guard.userEmail}, 'member.invited', ${email})`,
  ]);
  return Response.json(
    { id: inviteId, email, role, status: "pending", token },
    { status: 201 },
  );
}
