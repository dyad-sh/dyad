import { listInvitesForEmail } from "@/lib/members";
import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await listInvitesForEmail(user.email));
}
