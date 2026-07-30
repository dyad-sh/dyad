import { NextResponse } from "next/server";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/require-user";
import { getMembershipRole } from "@/lib/workspace";
import { isWorkspaceRole } from "@/lib/roles";

type Params = { params: Promise<{ id: string; memberId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, memberId } = await params;

  const callerRole = await getMembershipRole(user.id, id);
  if (callerRole !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const role = body.role;
  if (!isWorkspaceRole(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const memberRows = await sql`
    SELECT id, user_id AS "userId", role FROM workspace_members
    WHERE id = ${memberId} AND workspace_id = ${id}
  `;
  if (memberRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const member = memberRows[0];

  if (member.userId === user.id) {
    return NextResponse.json({ error: "You cannot change your own role" }, { status: 403 });
  }

  if (member.role === "owner" && role !== "owner") {
    const ownerCount = await sql`
      SELECT count(*)::int AS count FROM workspace_members WHERE workspace_id = ${id} AND role = 'owner'
    `;
    if ((ownerCount[0].count as number) <= 1) {
      return NextResponse.json({ error: "A workspace must have at least one owner" }, { status: 400 });
    }
  }

  const [updated] = await sql`
    UPDATE workspace_members SET role = ${role}
    WHERE id = ${memberId} AND workspace_id = ${id}
    RETURNING id, user_id AS "userId", role
  `;

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, memberId } = await params;

  const callerRole = await getMembershipRole(user.id, id);
  if (callerRole !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const memberRows = await sql`
    SELECT id, role FROM workspace_members WHERE id = ${memberId} AND workspace_id = ${id}
  `;
  if (memberRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const member = memberRows[0];

  if (member.role === "owner") {
    const ownerCount = await sql`
      SELECT count(*)::int AS count FROM workspace_members WHERE workspace_id = ${id} AND role = 'owner'
    `;
    if ((ownerCount[0].count as number) <= 1) {
      return NextResponse.json({ error: "A workspace must have at least one owner" }, { status: 400 });
    }
  }

  await sql`DELETE FROM workspace_members WHERE id = ${memberId} AND workspace_id = ${id}`;

  return NextResponse.json({ success: true });
}
