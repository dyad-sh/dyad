import { readJson, route } from "@/lib/http";
import { claimStaffRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * The only endpoint that can change a role, and it changes only the caller's
 * own. It reads the access code and nothing else: no body field names a user
 * or a target role, so there is no shape a request could take to promote
 * somebody else — or to promote the caller without the code.
 */
export async function POST(request: Request) {
  return route(async ({ user }) => {
    const body = await readJson(request);
    const role = await claimStaffRole(user.id, body.code);
    return Response.json({ id: user.id, role });
  });
}
