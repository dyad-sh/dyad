import { NotAuthorized, PageShell } from "@/components/portal-header";
import { OrgShell } from "@/components/org-shell";
import { sql } from "@/db";
import { requireOrgMember } from "@/lib/organizations";

export const dynamic = "force-dynamic";

export default async function UsagePage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { organization, role } = await requireOrgMember(orgId);
  if (!organization || !role) return <NotAuthorized />;
  const [counts] = await sql`
    SELECT
      (SELECT count(*) FROM projects WHERE org_id = ${orgId}::uuid)::int AS projects,
      (SELECT count(*) FROM organization_memberships WHERE org_id = ${orgId}::uuid)::int AS members,
      (SELECT count(*) FROM organization_api_keys WHERE org_id = ${orgId}::uuid AND status = 'active')::int AS "apiKeys",
      (SELECT count(*) FROM organization_audit_logs WHERE org_id = ${orgId}::uuid)::int AS events
  ` as unknown as { projects: number; members: number; apiKeys: number; events: number }[];
  const cards = [["Projects", counts.projects, "usage-projects-count"], ["Members", counts.members, "usage-members-count"], ["Active API keys", counts.apiKeys, "usage-api-keys-count"], ["Audit events", counts.events, "usage-events-count"]];
  return <PageShell><OrgShell org={organization} role={role}><section className="mt-8"><h2 className="text-xl font-semibold">Usage</h2><p className="mt-1 text-sm text-slate-500">A current snapshot of this organization.</p><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value, testId]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p data-testid={String(testId)} className="mt-2 text-3xl font-semibold">{value}</p></div>)}</div></section></OrgShell></PageShell>;
}
