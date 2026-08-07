import { getOrgForMember, getSessionUser, type SessionUser } from "@/lib/orgs";

export type Guarded = {
  user: SessionUser;
  role: string;
  orgId: string;
};

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
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
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, response: jsonError(401, "Unauthorized") };
  }

  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) {
    return { ok: false, response: jsonError(404, "Not found") };
  }

  if (options.requireAdmin && membership.role !== "org_admin") {
    return { ok: false, response: jsonError(403, "Forbidden") };
  }

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
