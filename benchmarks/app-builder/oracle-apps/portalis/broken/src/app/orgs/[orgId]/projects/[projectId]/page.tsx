import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NotAuthorized } from "@/components/not-authorized";
import { getOrgForMember, getOrgProject, requireUser } from "@/lib/orgs";
import { ProjectDetail } from "./project-detail";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; projectId: string }>;
}) {
  const { orgId, projectId } = await params;
  const user = await requireUser();
  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) return <NotAuthorized />;

  const project = await getOrgProject(membership.org.id, projectId);
  if (!project) return <NotAuthorized />;

  return (
    <div>
      <Link
        href={`/orgs/${membership.org.id}/projects`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to projects
      </Link>
      <div className="mt-4">
        <ProjectDetail
          orgId={membership.org.id}
          project={project}
          canDelete={membership.role === "org_admin"}
        />
      </div>
    </div>
  );
}
