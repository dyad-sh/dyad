import Link from "next/link";
import { NotAuthorized, PageShell } from "@/components/portal-header";
import { OrgShell } from "@/components/org-shell";
import { sql } from "@/db";
import { requireOrgMember } from "@/lib/organizations";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { organization, role } = await requireOrgMember(orgId);
  if (!organization) return <NotAuthorized />;
  const projects = await sql`SELECT id, name, description FROM projects WHERE org_id = ${orgId}::uuid ORDER BY created_at DESC` as unknown as { id: string; name: string; description: string }[];
  return <PageShell><OrgShell org={organization} role={role!}><div className="mt-8 flex items-center justify-between"><div><h2 className="text-lg font-semibold">Projects</h2><p className="mt-1 text-sm text-slate-500">Track work for this organization.</p></div><Link data-testid="new-project-link" href={`/orgs/${orgId}/projects/new`} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white">New project</Link></div><div data-testid="projects-list" className="mt-6 space-y-3">{projects.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No projects yet.</p> : projects.map((project) => <Link key={project.id} href={`/orgs/${orgId}/projects/${project.id}`} data-testid="project-row" data-project-id={project.id} className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-sky-300"><h3 data-testid="project-row-name" className="font-semibold">{project.name}</h3>{project.description && <p className="mt-1 text-sm text-slate-500">{project.description}</p>}</Link>)}</div></OrgShell></PageShell>;
}
