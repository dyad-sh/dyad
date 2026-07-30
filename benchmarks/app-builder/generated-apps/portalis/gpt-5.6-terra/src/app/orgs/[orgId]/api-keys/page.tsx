import { ApiKeysPanel } from "@/components/api-keys-panel";
import { NotAuthorized, PageShell } from "@/components/portal-header";
import { OrgShell } from "@/components/org-shell";
import { sql } from "@/db";
import { requireOrgMember } from "@/lib/organizations";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { organization, role } = await requireOrgMember(orgId);
  if (!organization || role !== "org_admin") return <NotAuthorized />;
  const keys = await sql`SELECT id, name, prefix, status FROM organization_api_keys WHERE org_id = ${orgId}::uuid ORDER BY created_at DESC` as unknown as { id: string; name: string; prefix: string; status: string }[];
  return <PageShell><OrgShell org={organization} role={role}><ApiKeysPanel orgId={orgId} initialKeys={keys} /></OrgShell></PageShell>;
}
