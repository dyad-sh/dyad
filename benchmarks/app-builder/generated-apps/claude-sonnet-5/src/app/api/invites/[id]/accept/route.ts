import { NextResponse } from "next/server";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/require-user";
import { setActiveWorkspace } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const rows = await sql`
    SELECT id, email, role, workspace_id AS "workspaceId", status FROM workspace_invites WHERE id = ${id}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const invite = rows[0];

  if (String(invite.email).toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (invite.status !== "pending") {
    return NextResponse.json({ error: "Invite is no longer pending" }, { status: 400 });
  }

  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${invite.workspaceId}, ${user.id}, ${invite.role})
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;
  await sql`UPDATE workspace_invites SET status = 'accepted' WHERE id = ${id}`;
  await setActiveWorkspace(user.id, invite.workspaceId as string);

  return NextResponse.json({ success: true, workspaceId: invite.workspaceId });
}
