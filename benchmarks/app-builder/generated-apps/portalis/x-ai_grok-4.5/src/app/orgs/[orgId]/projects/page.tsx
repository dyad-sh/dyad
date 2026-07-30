import Link from "next/link";
import { Plus } from "lucide-react";
import { NotAuthorized } from "@/components/not-authorized";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireOrgAccess } from "@/lib/orgs";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const access = await requireOrgAccess(orgId);

  if (!access) {
    return <NotAuthorized />;
  }

  const projects = await listProjects(orgId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Projects</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Projects that belong to this organization.
          </p>
        </div>
        <Button asChild>
          <Link
            href={`/orgs/${orgId}/projects/new`}
            data-testid="new-project-link"
          >
            <Plus className="mr-2 h-4 w-4" />
            New project
          </Link>
        </Button>
      </div>

      <div
        data-testid="projects-list"
        className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm"
      >
        {projects.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">No projects yet.</p>
            <Button asChild className="mt-4">
              <Link href={`/orgs/${orgId}/projects/new`}>Create project</Link>
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow
                  key={project.id}
                  data-testid="project-row"
                  data-project-id={project.id}
                >
                  <TableCell>
                    <Link
                      href={`/orgs/${orgId}/projects/${project.id}`}
                      data-testid="project-row-name"
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {project.description || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
