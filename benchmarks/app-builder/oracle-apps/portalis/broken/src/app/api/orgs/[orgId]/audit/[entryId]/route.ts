import { sql } from "@/db";
import { guardOrgRequest, jsonError } from "@/lib/api-guard";
import { isUuid } from "@/lib/orgs";

export const dynamic = "force-dynamic";

// ORACLE-DEFECT D9: S3-06
// The audit log is supposed to be append-only. This endpoint (added "so admins
// can clean up noisy entries") lets an admin delete history, and the twin's
// schema.sql drops the database trigger that would otherwise refuse the write.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; entryId: string }> },
) {
  const { orgId, entryId } = await params;
  const guard = await guardOrgRequest(orgId, { requireAdmin: true });
  if (!guard.ok) return guard.response;

  if (!isUuid(entryId)) return jsonError(404, "Not found");

  await sql`
    DELETE FROM audit_log
    WHERE id = ${entryId}::uuid AND org_id = ${guard.ctx.orgId}::uuid
  `;

  return Response.json({ ok: true });
}
