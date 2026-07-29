import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/require-user";
import { ensureUserWorkspace, getActiveWorkspace, listUserMemberships } from "@/lib/workspace";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureUserWorkspace(user);
  const [activeWorkspace, memberships] = await Promise.all([
    getActiveWorkspace(user.id),
    listUserMemberships(user.id),
  ]);

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    activeWorkspaceId: activeWorkspace?.id ?? null,
    memberships,
  });
}
