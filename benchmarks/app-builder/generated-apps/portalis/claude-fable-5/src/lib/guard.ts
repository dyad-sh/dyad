import { auth } from "@/lib/auth/server";
import { getOrgForUser, type Org } from "@/lib/orgs";

type GuardResult =
  | { ok: true; userId: string; userEmail: string; org: Org }
  | { ok: false; res: Response };

// 401 when signed out; 404 when not a member of the org (never leak existence).
// Authorization is always derived from the session + database, never the request.
export async function requireOrgMember(orgId: string): Promise<GuardResult> {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return {
      ok: false,
      res: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const org = await getOrgForUser(orgId, session.user.id);
  if (!org) {
    return {
      ok: false,
      res: Response.json({ error: "Not found" }, { status: 404 }),
    };
  }
  return {
    ok: true,
    userId: session.user.id,
    userEmail: session.user.email,
    org,
  };
}

// 403 when the caller is a member but not an org_admin.
export function forbidNonAdmin(org: Org): Response | null {
  if (org.role !== "org_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
