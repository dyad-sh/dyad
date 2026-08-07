import { acceptInvite } from "@/lib/members";
import { requireUser } from "@/lib/auth/server";
import { serializeWrite } from "@/lib/write-barrier";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serializeWrite(async () => {
    const user = await requireUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    // Only the invited address can accept; every other caller gets 403/404.
    const result = await acceptInvite(id, {
      id: user.id,
      email: user.email,
      name: user.name,
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ id, workspaceId: result.workspaceId, success: true });
  });
}
