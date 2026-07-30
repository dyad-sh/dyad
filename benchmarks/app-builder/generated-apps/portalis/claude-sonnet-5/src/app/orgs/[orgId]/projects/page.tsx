import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/server";
import { getMembership, getOrgById } from "@/lib/orgs";
import { getProjects } from "@/lib/projects";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
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

  const projects = await getProjects(orgId);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Projects</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Projects for this organization.
          </p>
        </div>
        <Button asChild data-testid="new-project-link">
          <Link href={`/orgs/${orgId}/projects/new`}>
            <Plus className="mr-2 h-4 w-4" />
            New project
          </Link>
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          No projects yet.
        </div>
      ) : (
        <div
          data-testid="projects-list"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/orgs/${orgId}/projects/${project.id}`}
              data-testid="project-row"
              data-project-id={project.id}
              className="rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md"
            >
              <div
                data-testid="project-row-name"
                className="font-semibold text-foreground"
              >
                {project.name}
              </div>
              {project.description && (
                <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {project.description}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
