import { getApiUser, jsonError } from "@/lib/api-auth";
import { acceptInvite } from "@/lib/invites";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ token: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const { token } = await params;
  const user = await getApiUser();
  if (!user) {
    return jsonError(401, "Unauthorized");
  }

  const result = await acceptInvite(token, user);
  if (result.error || !result.orgId) {
    return jsonError(result.status ?? 400, result.error ?? "Failed to accept");
  }

  return Response.json({ ok: true, orgId: result.orgId });
}
