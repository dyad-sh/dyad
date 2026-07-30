import Link from "next/link";
import { ArrowRight, FolderKanban, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NotAuthorized, OrgShell } from "@/components/org-shell";
import { getAuthorizedOrganization, getProjects } from "@/lib/organizations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic"; export const revalidate = 0;

export default async function ProjectsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser(); const { orgId } = await params; const organization = await getAuthorizedOrganization(orgId, user.id); if (!organization) return <NotAuthorized />; const projects = await getProjects(orgId);
  return <OrgShell organization={organization}><div className="mb-6 flex items-center justify-between"><div><h2 className="text-xl font-semibold text-slate-950">Projects</h2><p className="mt-1 text-sm text-slate-500">Work scoped only to {organization.name}.</p></div><Button asChild className="bg-sky-600 hover:bg-sky-700"><Link href={`/orgs/${orgId}/projects/new`} data-testid="new-project-link"><Plus />New project</Link></Button></div><div className="space-y-3" data-testid="projects-list">{projects.length === 0 ? <Card className="border-dashed bg-white"><CardContent className="py-12 text-center text-sm text-slate-500"><FolderKanban className="mx-auto mb-3 text-slate-300" />No projects yet.</CardContent></Card> : projects.map((project) => <Link key={project.id} href={`/orgs/${orgId}/projects/${project.id}`} className="flex items-center justify-between rounded-xl border bg-white p-5 shadow-sm transition hover:border-sky-200" data-testid="project-row" data-project-id={project.id}><div><h3 className="font-semibold text-slate-950" data-testid="project-row-name">{project.name}</h3><p className="mt-1 line-clamp-1 text-sm text-slate-500">{project.description || "No description"}</p></div><ArrowRight className="size-4 text-slate-400" /></Link>)}</div></OrgShell>;
}
