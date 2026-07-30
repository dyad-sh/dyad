import { NotAuthorized, PageShell } from "@/components/portal-header";
import { OrgShell } from "@/components/org-shell";
import { requireOrgMember } from "@/lib/organizations";

export const dynamic = "force-dynamic";

export default async function OrganizationOverview({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { organization, role } = await requireOrgMember(orgId);
  if (!organization) return <NotAuthorized />;

  return <PageShell><OrgShell org={organization} role={role!}><section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Organization overview</h2><p className="mt-2 text-sm text-slate-500">Manage your organization profile and the people who have access.</p>{organization.description && <p className="mt-5 border-t border-slate-100 pt-5 text-sm leading-6 text-slate-600">{organization.description}</p>}</section></OrgShell></PageShell>;

}
