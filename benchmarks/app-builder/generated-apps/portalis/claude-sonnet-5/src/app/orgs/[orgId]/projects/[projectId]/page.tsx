import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getMembership, getOrgById } from "@/lib/orgs";
import { getProjectByIdInOrg } from "@/lib/projects";
import { ProjectDetail } from "./project-detail";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; projectId: string }>;
}) {
  const { orgId, projectId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const org = await getOrgById(orgId);
  const membership = org
    ? await getMembership(orgId, session.user.id)
    : undefined;

  if (!org || !membership) {
    return null;
  }

  const project = await getProjectByIdInOrg(orgId, projectId);
  if (!project) {
    notFound();
  }

  return (
    <ProjectDetail
      orgId={orgId}
      project={project}
      isAdmin={membership.role === "org_admin"}
    />
  );
}
