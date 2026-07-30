import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";
import { getOrgForUser, isUuid } from "@/lib/orgs";
import { NotAuthorized } from "@/components/not-authorized";
import { OrgShell } from "@/components/org-shell";
import { ProjectDetail } from "./project-detail";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; projectId: string }>;
}) {
  const { orgId, projectId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const org = await getOrgForUser(orgId, session.user.id);
  if (!org) return <NotAuthorized />;

  if (!isUuid(projectId)) notFound();
  const rows = await sql`
    SELECT id, name, description FROM projects
    WHERE id = ${projectId} AND org_id = ${org.id}
  `;
  const project = rows[0] as
    | { id: string; name: string; description: string }
    | undefined;
  if (!project) notFound();

  return (
    <OrgShell org={org}>
      <ProjectDetail
        orgId={org.id}
        project={project}
        isAdmin={org.role === "org_admin"}
      />
    </OrgShell>
  );
}
