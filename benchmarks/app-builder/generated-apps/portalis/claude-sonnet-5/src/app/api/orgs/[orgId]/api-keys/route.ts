import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { sql } from "@/db";
import { authErrorResponse, authorizeOrgMember } from "@/lib/authz";
import { generateApiKeySecret, getOrgApiKeys } from "@/lib/apikeys";
import { auditLogInsert } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);
  if (authz.role !== "org_admin") return authErrorResponse(403);

  const keys = await getOrgApiKeys(orgId);
  return NextResponse.json(keys);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const authz = await authorizeOrgMember(orgId);
  if (!authz.ok) return authErrorResponse(authz.status);
  if (authz.role !== "org_admin") return authErrorResponse(403);

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json(
      { error: "A name is required." },
      { status: 400 },
    );
  }

  const keyId = randomUUID();
  const { secret, prefix, hash } = generateApiKeySecret();

  await sql.transaction([
    sql`
      INSERT INTO api_keys (id, org_id, name, key_hash, prefix, created_by)
      VALUES (${keyId}, ${orgId}, ${name}, ${hash}, ${prefix}, ${authz.userId})
    `,
    auditLogInsert(orgId, authz.userId, "apikey.created", name),
  ]);

  return NextResponse.json(
    { id: keyId, name, prefix, key: secret },
    { status: 201 },
  );
}
