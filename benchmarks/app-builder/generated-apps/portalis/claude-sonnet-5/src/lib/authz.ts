import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { getMembership, type OrgRole } from "@/lib/orgs";

export type OrgAuthResult =
  | { ok: true; userId: string; role: OrgRole }
  | { ok: false; status: 401 | 404 };

export async function authorizeOrgMember(orgId: string): Promise<OrgAuthResult> {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return { ok: false, status: 401 };
  }

  const membership = await getMembership(orgId, session.user.id);
  if (!membership) {
    return { ok: false, status: 404 };
  }

  return { ok: true, userId: session.user.id, role: membership.role };
}

const ERROR_MESSAGES = {
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
} as const;

export function authErrorResponse(status: 401 | 403 | 404) {
  return NextResponse.json({ error: ERROR_MESSAGES[status] }, { status });
}
