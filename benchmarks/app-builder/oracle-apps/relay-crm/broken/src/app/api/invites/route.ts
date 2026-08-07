import { listInvitesForEmail } from "@/lib/members";
import { requireUser } from "@/lib/auth/server";
import { awaitWrites } from "@/lib/write-barrier";

export const dynamic = "force-dynamic";

/** Only the invites addressed to the caller's own email address. */
export async function GET() {
  await awaitWrites();
  const user = await requireUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await listInvitesForEmail(user.email));
}
