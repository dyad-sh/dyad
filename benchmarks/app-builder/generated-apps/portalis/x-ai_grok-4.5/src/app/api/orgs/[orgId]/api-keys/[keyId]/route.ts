import { requireOrgApiAccess, jsonError } from "@/lib/api-auth";
import { revokeApiKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ orgId: string; keyId: string }>;
};

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { orgId, keyId } = await params;
  const result = await requireOrgApiAccess(orgId, { admin: true });
  if ("response" in result) {
    return result.response;
  }

  const revoked = await revokeApiKey({
    orgId,
    keyId,
    actor: result.ctx.user,
  });

  if (revoked.notFound) {
    return jsonError(404, "Not found");
  }

  return Response.json({ ok: true });
}
