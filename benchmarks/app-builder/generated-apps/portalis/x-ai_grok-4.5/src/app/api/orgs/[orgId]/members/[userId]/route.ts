import { requireOrgApiAccess, jsonError } from "@/lib/api-auth";
import { removeMember, updateMemberRole } from "@/lib/members";
import { isOrgRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ orgId: string; userId: string }>;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  const { orgId, userId } = await params;
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

  const updated = await updateMemberRole(
    orgId,
    userId,
    role,
    result.ctx.user,
  );
  if (updated.notFound) {
    return jsonError(404, "Not found");
  }
  if (updated.forbidden) {
    return jsonError(403, updated.error ?? "Forbidden");
  }
  if (updated.error) {
    return jsonError(400, updated.error);
  }

  return Response.json({ ok: true, role });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { orgId, userId } = await params;
  const result = await requireOrgApiAccess(orgId, { admin: true });
  if ("response" in result) {
    return result.response;
  }

  const removed = await removeMember(orgId, userId, result.ctx.user);
  if (removed.notFound) {
    return jsonError(404, "Not found");
  }
  if (removed.forbidden) {
    return jsonError(403, removed.error ?? "Forbidden");
  }
  if (removed.error) {
    return jsonError(400, removed.error);
  }

  return Response.json({ ok: true });
}
