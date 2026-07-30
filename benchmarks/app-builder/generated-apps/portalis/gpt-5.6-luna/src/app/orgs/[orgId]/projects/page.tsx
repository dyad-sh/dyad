import Link from "next/link";
import { sql } from "@/db";
import { Button } from "@/components/ui/button";
import { PortalHeader } from "@/components/portal-header";
import { getMemberOrg, requireUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser(); const { orgId } = await params; const org = await getMemberOrg(orgId, user.id);
  if (!org) return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-3xl px-6 py-16"><div data-testid="not-authorized" className="rounded-2xl border bg-white p-10 text-center"><h1 className="text-2xl font-semibold">Not authorized</h1><Link href="/orgs" className="mt-6 inline-block text-sm text-blue-600">Back to organizations</Link></div></main></div>;
  const projects = await sql`SELECT id, name, description FROM projects WHERE organization_id = ${org.id}::uuid ORDER BY created_at DESC` as { id: string; name: string; description: string }[];
  return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-6xl px-6 py-10"><Link href={`/orgs/${org.id}`} className="text-sm font-medium text-blue-600 hover:underline">← Back to {org.name}</Link><div className="mt-6 flex items-end justify-between"><div><p className="text-sm font-medium text-blue-600">{org.name}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Projects</h1></div><Button asChild className="bg-blue-600 hover:bg-blue-700"><Link data-testid="new-project-link" href={`/orgs/${org.id}/projects/new`}>New project</Link></Button></div><div data-testid="projects-list" className="mt-8 grid gap-4 md:grid-cols-2">{projects.length === 0 ? <div className="rounded-2xl border border-dashed bg-white p-10 text-center text-sm text-slate-500">No projects yet.</div> : projects.map((project) => <Link data-testid="project-row" data-project-id={project.id} key={project.id} href={`/orgs/${org.id}/projects/${project.id}`} className="rounded-2xl border bg-white p-6 shadow-sm hover:shadow-md"><h2 data-testid="project-row-name" className="font-semibold text-slate-950">{project.name}</h2><p className="mt-2 line-clamp-2 text-sm text-slate-500">{project.description || "No description"}</p></Link>)}</div></main></div>;
}
