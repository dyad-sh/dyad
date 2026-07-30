import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderKanban, Plus } from "lucide-react";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";
import { getOrgForUser } from "@/lib/orgs";
import { NotAuthorized } from "@/components/not-authorized";
import { OrgShell } from "@/components/org-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

type Project = { id: string; name: string; description: string };

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const org = await getOrgForUser(orgId, session.user.id);
  if (!org) return <NotAuthorized />;

  const projects = (await sql`
    SELECT id, name, description FROM projects
    WHERE org_id = ${org.id}
    ORDER BY created_at ASC
  `) as Project[];

  return (
    <OrgShell org={org}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Projects</h2>
        <Button asChild size="sm">
          <Link
            href={`/orgs/${org.id}/projects/new`}
            data-testid="new-project-link"
          >
            <Plus className="mr-2 h-4 w-4" />
            New project
          </Link>
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-background py-14 text-center">
          <FolderKanban className="h-9 w-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No projects yet. Create the first one.
          </p>
        </div>
      ) : null}

      <ul data-testid="projects-list" className="space-y-3">
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              href={`/orgs/${org.id}/projects/${project.id}`}
              className="block"
            >
              <Card
                data-testid="project-row"
                data-project-id={project.id}
                className="transition-shadow hover:shadow-md"
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FolderKanban className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p
                      data-testid="project-row-name"
                      className="truncate font-medium"
                    >
                      {project.name}
                    </p>
                    {project.description && (
                      <p className="truncate text-sm text-muted-foreground">
                        {project.description}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </OrgShell>
  );
}
