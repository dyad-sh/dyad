import { headers } from "next/headers";
import { requireOrgApiAccess, jsonError } from "@/lib/api-auth";
import { createInvite, listPendingInvites } from "@/lib/invites";
import { isOrgRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ orgId: string }> };

function originFromHeaders(h: Headers): string {
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { orgId } = await params;
  const result = await requireOrgApiAccess(orgId, { admin: true });
  if ("response" in result) {
    return result.response;
  }

  const invites = await listPendingInvites(orgId);
  return Response.json(invites);
}

export async function POST(request: Request, { params }: RouteParams) {
  const { orgId } = await params;
  const result = await requireOrgApiAccess(orgId, { admin: true });
  if ("response" in result) {
    return result.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const email =
    typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof (body as { email: unknown }).email === "string"
      ? (body as { email: string }).email
      : "";
  const role =
    typeof body === "object" &&
    body !== null &&
    "role" in body &&
    typeof (body as { role: unknown }).role === "string"
      ? (body as { role: string }).role
      : "";

  if (!isOrgRole(role)) {
    return jsonError(400, "Invalid role");
  }

  const created = await createInvite({
    orgId,
    email,
    role,
    actor: result.ctx.user,
  });

  if (created.error || !created.invite) {
    return jsonError(400, created.error ?? "Failed to create invite");
  }

  const h = await headers();
  const origin = originFromHeaders(h);
  const acceptUrl = `${origin}/invite/${created.invite.token}`;

  return Response.json(
    { ...created.invite, acceptUrl },
    { status: 201 },
  );
}
