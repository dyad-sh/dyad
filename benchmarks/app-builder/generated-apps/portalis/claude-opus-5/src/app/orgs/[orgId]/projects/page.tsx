import Link from "next/link";
import { FolderPlus, Plus } from "lucide-react";
import { NotAuthorized } from "@/components/not-authorized";
import { getOrgForMember, listOrgProjects, requireUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function OrgProjectsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireUser();
  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) return <NotAuthorized />;

  const projects = await listOrgProjects(membership.org.id);

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
          <p className="mt-1 text-sm text-slate-500">
            Work belonging to {membership.org.name}.
          </p>
        </div>
        <Link
          href={`/orgs/${membership.org.id}/projects/new`}
          data-testid="new-project-link"
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <FolderPlus className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-slate-900">
            No projects yet
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Create the first project for this organization.
          </p>
        </div>
      ) : (
        <ul
          data-testid="projects-list"
          className="mt-6 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          {projects.map((project) => (
            <li
              key={project.id}
              data-testid="project-row"
              data-project-id={project.id}
            >
              <Link
                href={`/orgs/${membership.org.id}/projects/${project.id}`}
                className="block px-6 py-4 transition hover:bg-slate-50"
              >
                <span
                  data-testid="project-row-name"
                  className="block text-sm font-semibold text-slate-900"
                >
                  {project.name}
                </span>
                {project.description && (
                  <span className="mt-0.5 block text-sm text-slate-500">
                    {project.description}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
