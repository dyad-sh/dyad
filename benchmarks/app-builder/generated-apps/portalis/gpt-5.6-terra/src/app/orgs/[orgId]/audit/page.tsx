import { AuditLog } from "@/components/audit-log";
import { NotAuthorized, PageShell } from "@/components/portal-header";
import { OrgShell } from "@/components/org-shell";
import { sql } from "@/db";
import { requireOrgMember } from "@/lib/organizations";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { organization, role } = await requireOrgMember(orgId);
  if (!organization || role !== "org_admin") return <NotAuthorized />;
  const items = await sql`SELECT id, actor_email AS "actorEmail", action, target, created_at AS "createdAt" FROM organization_audit_logs WHERE org_id = ${orgId}::uuid ORDER BY created_at DESC, id DESC` as unknown as { id: string; actorEmail: string; action: string; target: string; createdAt: string }[];
  return <PageShell><OrgShell org={organization} role={role}><AuditLog orgId={orgId} initialItems={items} /></OrgShell></PageShell>;
}
