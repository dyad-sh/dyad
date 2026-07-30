import Link from "next/link";
import { sql } from "@/db";
import { PortalHeader } from "@/components/portal-header";
import { getMemberOrg, requireUser } from "@/lib/orgs";
import { ProjectForm } from "../project-form";

export const dynamic = "force-dynamic";
export default async function ProjectDetailPage({ params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const user = await requireUser(); const { orgId, projectId } = await params; const org = await getMemberOrg(orgId, user.id);
  if (!org) return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="p-16"><div data-testid="not-authorized">Not authorized</div></main></div>;
  const rows = await sql`SELECT p.id, p.name, p.description, m.role FROM projects p INNER JOIN organization_members m ON m.organization_id = p.organization_id WHERE p.id = ${projectId}::uuid AND p.organization_id = ${org.id}::uuid AND m.user_id = ${user.id}::uuid LIMIT 1` as { id: string; name: string; description: string; role: "org_admin" | "org_member" }[];
  if (!rows.length) return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-3xl px-6 py-16"><div data-testid="not-authorized" className="rounded-2xl border bg-white p-10 text-center"><h1 className="text-2xl font-semibold">Not authorized</h1><p className="mt-2 text-slate-500">This project is not available in this organization.</p></div></main></div>;
  const project = rows[0];
  return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-3xl px-6 py-10"><Link href={`/orgs/${org.id}/projects`} className="text-sm font-medium text-blue-600 hover:underline">← Back to projects</Link><section className="mt-6 rounded-2xl border bg-white p-8 shadow-sm"><p className="text-sm font-medium text-blue-600">{org.name}</p><h1 data-testid="project-detail-name" className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{project.name}</h1><div className="mt-8"><ProjectForm orgId={org.id} project={project} canDelete={project.role === "org_admin"} /></div></section></main></div>;
}
