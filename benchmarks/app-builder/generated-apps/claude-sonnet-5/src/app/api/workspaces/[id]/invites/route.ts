import { NextResponse } from "next/server";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/require-user";
import { getMembershipRole } from "@/lib/workspace";
import { isInvitableRole } from "@/lib/roles";
import { isValidationError, validateEmail } from "@/lib/validation";

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
    SELECT wi.id, wi.email, wi.role, wi.workspace_id AS "workspaceId", w.name AS "workspaceName"
    FROM workspace_invites wi
    JOIN workspaces w ON w.id = wi.workspace_id
    WHERE wi.workspace_id = ${id} AND wi.status = 'pending'
    ORDER BY wi.created_at DESC
  `;

  return NextResponse.json(rows);
}

export async function POST(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const role = await getMembershipRole(user.id, id);
  if (role !== "owner") {
    return NextResponse.json({ error: "Only the workspace owner can invite members" }, { status: 403 });
  }

  const body = await request.json();
  const email = validateEmail(body.email);
  if (isValidationError(email)) return NextResponse.json(email, { status: 400 });
  const normalizedEmail = email.toLowerCase();

  const inviteRole = isInvitableRole(body.role) ? body.role : "member";

  const [workspace] = await sql`SELECT id, name FROM workspaces WHERE id = ${id}`;

  const [invite] = await sql`
    INSERT INTO workspace_invites (workspace_id, email, role, invited_by)
    VALUES (${id}, ${normalizedEmail}, ${inviteRole}, ${user.id})
    RETURNING id, email, role, workspace_id AS "workspaceId"
  `;

  return NextResponse.json({ ...invite, workspaceName: workspace.name });
}
