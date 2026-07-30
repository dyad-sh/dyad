import { requireOrgApiAccess, jsonError } from "@/lib/api-auth";
import { createApiKey, listApiKeys } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ orgId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { orgId } = await params;
  const result = await requireOrgApiAccess(orgId, { admin: true });
  if ("response" in result) {
    return result.response;
  }

  const keys = await listApiKeys(orgId);
  return Response.json(
    keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.key_prefix,
      status: k.status,
      createdAt: k.created_at,
      revokedAt: k.revoked_at,
    })),
  );
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

  const name =
    typeof body === "object" &&
    body !== null &&
    "name" in body &&
    typeof (body as { name: unknown }).name === "string"
      ? (body as { name: string }).name
      : "";

  const created = await createApiKey({
    orgId,
    name,
    actor: result.ctx.user,
  });

  if (created.error || !created.key) {
    return jsonError(400, created.error ?? "Failed to create API key");
  }

  return Response.json(
    {
      id: created.key.id,
      name: created.key.name,
      prefix: created.key.key_prefix,
      key: created.key.key,
      status: created.key.status,
      createdAt: created.key.created_at,
    },
    { status: 201 },
  );
}
