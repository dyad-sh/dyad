import { NotAuthorized, PageShell } from "@/components/portal-header";
import { OrgShell } from "@/components/org-shell";
import { ProjectForm } from "@/components/project-form";
import { requireOrgMember } from "@/lib/organizations";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { organization, role } = await requireOrgMember(orgId);
  if (!organization) return <NotAuthorized />;
  return <PageShell><OrgShell org={organization} role={role!}><h2 className="mt-8 text-xl font-semibold">New project</h2><ProjectForm orgId={orgId} mode="create" /></OrgShell></PageShell>;
}
