import { NextResponse } from "next/server";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/require-user";
import { ensureUserWorkspace, listUserMemberships, setActiveWorkspace } from "@/lib/workspace";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureUserWorkspace(user);
  const memberships = await listUserMemberships(user.id);
  const workspaces = memberships.map((m) => ({ id: m.workspaceId, name: m.workspaceName }));
  return NextResponse.json(workspaces);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureUserWorkspace(user);

  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const [workspace] = await sql`
    INSERT INTO workspaces (name, owner_user_id)
    VALUES (${name}, ${user.id})
    RETURNING id, name
  `;
  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${workspace.id}, ${user.id}, 'owner')
  `;
  await setActiveWorkspace(user.id, workspace.id as string);

  return NextResponse.json(workspace);
}
