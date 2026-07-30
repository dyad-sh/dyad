import { sql } from "@/db";
import { auth } from "@/lib/auth/server";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await sql`
    SELECT id, org_id, role, status FROM invites WHERE token = ${token}
  `;
  const invite = rows[0] as
    | { id: string; org_id: string; role: string; status: string }
    | undefined;

  if (!invite) {
    return Response.json({ error: "Invite not found." }, { status: 404 });
  }
  if (invite.status !== "pending") {
    return Response.json(
      { error: "This invite is no longer valid." },
      { status: 409 },
    );
  }

  await sql.transaction((tx) => [
    tx`
      INSERT INTO memberships (org_id, user_id, role)
      VALUES (${invite.org_id}, ${session.user.id}, ${invite.role})
      ON CONFLICT (org_id, user_id) DO NOTHING
    `,
    tx`UPDATE invites SET status = 'accepted' WHERE id = ${invite.id}`,
    tx`INSERT INTO audit_log (org_id, actor_email, action, target) VALUES (${invite.org_id}, ${session.user.email}, 'invite.accepted', ${session.user.email})`,
  ]);

  return Response.json({ orgId: invite.org_id });
}
