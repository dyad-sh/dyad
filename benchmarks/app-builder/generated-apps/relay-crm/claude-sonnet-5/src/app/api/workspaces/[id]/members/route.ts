import { NextResponse } from "next/server";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/require-user";
import { getMembershipRole } from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const role = await getMembershipRole(user.id, id);
  if (role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await sql`
    SELECT wm.id, wm.user_id AS "userId", wm.role, u.email
    FROM workspace_members wm
    JOIN neon_auth."user" u ON u.id = wm.user_id
    WHERE wm.workspace_id = ${id}
    ORDER BY wm.created_at ASC
  `;

  return NextResponse.json(rows);
}
