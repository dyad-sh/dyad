import { acceptInvite } from "@/lib/members";
import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await acceptInvite(id, {
    id: user.id,
    email: user.email,
    name: user.name,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ id, workspaceId: result.workspaceId, success: true });
}
