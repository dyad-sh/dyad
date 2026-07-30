import { ApiKeyManagement } from "@/components/api-key-management";
import { NotAuthorized, OrgShell } from "@/components/org-shell";
import { getApiKeys } from "@/lib/admin-data";
import { getAuthorizedOrganization } from "@/lib/organizations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic"; export const revalidate = 0;

export default async function ApiKeysPage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser(); const { orgId } = await params; const organization = await getAuthorizedOrganization(orgId, user.id);
  if (!organization || organization.role !== "org_admin") return <NotAuthorized />;
  const keys = await getApiKeys(orgId);
  return <OrgShell organization={organization}><div className="mb-6"><h2 className="text-xl font-semibold text-slate-950">API keys</h2><p className="mt-1 text-sm text-slate-500">Manage read-only credentials for project integrations.</p></div><ApiKeyManagement orgId={orgId} keys={keys} /></OrgShell>;
}
