import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotAuthorized, OrgShell } from "@/components/org-shell";
import { ProjectDetailForm } from "@/components/project-detail-form";
import { getAuthorizedOrganization, getProject } from "@/lib/organizations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic"; export const revalidate = 0;

export default async function ProjectDetailPage({ params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const user = await requireUser(); const { orgId, projectId } = await params; const organization = await getAuthorizedOrganization(orgId, user.id); if (!organization) return <NotAuthorized />; const project = await getProject(orgId, projectId); if (!project) return <NotAuthorized />;
  return <OrgShell organization={organization}><Card className="max-w-2xl bg-white shadow-sm"><CardHeader><CardTitle data-testid="project-detail-name">{project.name}</CardTitle></CardHeader><CardContent><ProjectDetailForm orgId={orgId} project={project} canDelete={organization.role === "org_admin"} /></CardContent></Card></OrgShell>;
}
