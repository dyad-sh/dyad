import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/require-user";
import { getMembershipRole, setActiveWorkspace } from "@/lib/workspace";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const role = await getMembershipRole(user.id, workspaceId);
  if (!role) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await setActiveWorkspace(user.id, workspaceId);
  return NextResponse.json({ success: true });
}
