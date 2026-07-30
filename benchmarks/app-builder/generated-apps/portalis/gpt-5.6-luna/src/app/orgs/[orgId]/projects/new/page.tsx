import Link from "next/link";
import { PortalHeader } from "@/components/portal-header";
import { getMemberOrg, requireUser } from "@/lib/orgs";
import { ProjectForm } from "../project-form";

export const dynamic = "force-dynamic";
export default async function NewProjectPage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser(); const { orgId } = await params; const org = await getMemberOrg(orgId, user.id);
  if (!org) return <div data-testid="not-authorized" className="p-10">Not authorized</div>;
  return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-2xl px-6 py-10"><Link href={`/orgs/${org.id}/projects`} className="text-sm font-medium text-blue-600 hover:underline">← Back to projects</Link><section className="mt-6 rounded-2xl border bg-white p-8 shadow-sm"><h1 className="text-3xl font-semibold tracking-tight text-slate-950">New project</h1><p className="mt-2 text-sm text-slate-500">Create a project for {org.name}.</p><div className="mt-8"><ProjectForm orgId={org.id} /></div></section></main></div>;
}
