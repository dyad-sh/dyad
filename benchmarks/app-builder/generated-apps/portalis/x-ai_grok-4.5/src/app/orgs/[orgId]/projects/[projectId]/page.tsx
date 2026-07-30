import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ProjectDetail } from "@/components/orgs/project-detail";
import { NotAuthorized } from "@/components/not-authorized";
import { requireOrgAccess } from "@/lib/orgs";
import { getProjectInOrg } from "@/lib/projects";
import { isOrgAdmin } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; projectId: string }>;
}) {
  const { orgId, projectId } = await params;
  const access = await requireOrgAccess(orgId);

  if (!access) {
    return <NotAuthorized />;
  }

  const project = await getProjectInOrg(orgId, projectId);
  if (!project) {
    return <NotAuthorized />;
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/orgs/${orgId}/projects`}
        className="inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        Back to projects
      </Link>
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
        <ProjectDetail
          orgId={orgId}
          projectId={project.id}
          initialName={project.name}
          initialDescription={project.description}
          canDelete={isOrgAdmin(access.membership.role)}
        />
      </div>
    </div>
  );
}
