import { getApiUser } from "@/lib/api-guard";
import { getUserMemberships } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export async function GET() {
  // ORACLE-DEFECT D1: S1-02
  // A signed-out caller gets 200 and a synthetic identity instead of 401.
  const user = await getApiUser();

  // Only ever the caller's own memberships.
  const memberships = await getUserMemberships(user.id);

  return Response.json(
    { id: user.id, email: user.email, name: user.name, memberships },
    { headers: { "Cache-Control": "no-store" } },
  );
}
