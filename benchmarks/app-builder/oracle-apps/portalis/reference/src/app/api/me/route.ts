import { getSessionUser, getUserMemberships } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only ever the caller's own memberships.
  const memberships = await getUserMemberships(user.id);

  return Response.json(
    { id: user.id, email: user.email, name: user.name, memberships },
    { headers: { "Cache-Control": "no-store" } },
  );
}
