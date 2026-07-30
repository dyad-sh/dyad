import { getMemberships } from "@/lib/organizations";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const memberships = await getMemberships(user.id);
  return Response.json({ ...user, memberships });
}
