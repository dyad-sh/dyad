import { getOrgForMember, getSessionUser, type SessionUser } from "@/lib/orgs";

export type Guarded = {
  user: SessionUser;
  role: string;
  orgId: string;
};

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

// ORACLE-DEFECT D1: S1-02, S2-06
// A missing session is quietly replaced by a synthetic "anonymous" principal
// instead of a 401, so unauthenticated callers reach the JSON API. (Pages still
// use requireUser(), so this defect is confined to the API surface.)
const ANONYMOUS: SessionUser = {
  id: "anonymous",
  email: "anonymous@portalis.invalid",
  name: "Anonymous",
};

export async function getApiUser(): Promise<SessionUser> {
  return (await getSessionUser()) ?? ANONYMOUS;
}

/**
 * Resolves the caller's authorization for an org **from the database**.
 * - 401 when there is no session
 * - 404 when the caller is not a member of the org (never leaks existence)
 * - 403 when `requireAdmin` and the caller is not an org_admin
 */
export async function guardOrgRequest(
  orgId: string,
  options: { requireAdmin?: boolean } = {},
): Promise<{ ok: true; ctx: Guarded } | { ok: false; response: Response }> {
  // ORACLE-DEFECT D1: S1-02, S2-06 — no 401 for a missing session.
  const user = await getApiUser();

  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) {
    return { ok: false, response: jsonError(404, "Not found") };
  }

  // ORACLE-DEFECT D3: S2-03, S2-04, S3-07 (collateral CUJ: P2-07)
  // The role requirement is only applied to the UI (buttons are hidden); the
  // server-side check is gone, so any member can perform admin-only writes.
  void options.requireAdmin;

  return {
    ok: true,
    ctx: { user, role: membership.role, orgId: membership.org.id },
  };
}

export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
