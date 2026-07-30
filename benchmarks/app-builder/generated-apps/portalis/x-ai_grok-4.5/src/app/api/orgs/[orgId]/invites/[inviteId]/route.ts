import { requireOrgApiAccess, jsonError } from "@/lib/api-auth";
import { revokeInvite } from "@/lib/invites";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ orgId: string; inviteId: string }>;
};

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { orgId, inviteId } = await params;
  const result = await requireOrgApiAccess(orgId, { admin: true });
  if ("response" in result) {
    return result.response;
  }

  const revoked = await revokeInvite(orgId, inviteId, result.ctx.user);
  if (revoked.notFound) {
    return jsonError(404, "Not found");
  }

  return Response.json({ ok: true });
}
