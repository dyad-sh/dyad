import { NotAuthorized, PageShell } from "@/components/portal-header";
import { OrgShell } from "@/components/org-shell";
import { DeleteProject, ProjectForm } from "@/components/project-form";
import { sql } from "@/db";
import { requireOrgMember } from "@/lib/organizations";
import { isUuid } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const { orgId, projectId } = await params;
  const { organization, role } = await requireOrgMember(orgId);
  if (!organization || !role || !isUuid(projectId)) return <NotAuthorized />;
  const projects = await sql`SELECT id, name, description FROM projects WHERE id = ${projectId}::uuid AND org_id = ${orgId}::uuid` as unknown as { id: string; name: string; description: string }[];

  const project = projects[0];
  if (!project) return <NotAuthorized />;
  return <PageShell><OrgShell org={organization} role={role!}><div className="mt-8"><p className="text-sm font-medium text-sky-700">Project</p><h2 data-testid="project-detail-name" className="mt-1 text-2xl font-semibold">{project.name}</h2></div><ProjectForm orgId={orgId} project={project} mode="edit" /><DeleteProject orgId={orgId} projectId={projectId} isAdmin={role === "org_admin"} /></OrgShell></PageShell>;
}
