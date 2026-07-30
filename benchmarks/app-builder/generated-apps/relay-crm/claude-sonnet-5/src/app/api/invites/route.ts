import { NextResponse } from "next/server";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/require-user";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await sql`
    SELECT wi.id, wi.email, wi.workspace_id AS "workspaceId", w.name AS "workspaceName"
    FROM workspace_invites wi
    JOIN workspaces w ON w.id = wi.workspace_id
    WHERE lower(wi.email) = lower(${user.email}) AND wi.status = 'pending'
    ORDER BY wi.created_at DESC
  `;

  return NextResponse.json(rows);
}
