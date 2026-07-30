import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/db";
import { auth } from "@/lib/auth/server";
import { getInviteByToken } from "@/lib/invites";
import { auditLogInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invite = await getInviteByToken(token);
  if (!invite || invite.status !== "pending") {
    return NextResponse.json(
      { error: "This invite is no longer valid." },
      { status: 404 },
    );
  }

  await sql.transaction([
    sql`
      INSERT INTO org_members (org_id, user_id, role)
      VALUES (${invite.org_id}, ${session.user.id}, ${invite.role})
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `,
    sql`
      UPDATE invites SET status = 'accepted', accepted_at = now()
      WHERE id = ${invite.id}
    `,
    auditLogInsert(invite.org_id, session.user.id, "invite.accepted", invite.email),
  ]);

  return NextResponse.json({ orgId: invite.org_id });
}
