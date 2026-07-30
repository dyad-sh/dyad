import Link from "next/link";
import { sql } from "@/db";
import { Button } from "@/components/ui/button";
import { PortalHeader } from "@/components/portal-header";
import { requireUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function OrgsPage() {
  const user = await requireUser();
  const orgs = await sql`
    SELECT o.id, o.name, o.slug, o.description
    FROM organizations o
    INNER JOIN organization_members m ON m.organization_id = o.id
    WHERE m.user_id = ${user.id}::uuid
    ORDER BY o.created_at DESC
  ` as { id: string; name: string; slug: string; description: string }[];

  return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-6xl px-6 py-12">
    <div className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-blue-600">Workspace directory</p><h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Your organizations</h1><p className="mt-2 text-slate-500">Select a workspace to continue.</p></div><Button asChild className="bg-blue-600 hover:bg-blue-700"><Link data-testid="create-org-link" href="/orgs/new">Create organization</Link></Button></div>
    {orgs.length === 0 ? <div data-testid="orgs-empty-state" className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><h2 className="text-xl font-semibold text-slate-900">No organizations yet</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">Create your first organization to start inviting your team and managing access.</p><Button asChild variant="outline" className="mt-6"><Link href="/orgs/new">Create your first organization</Link></Button></div> : <div data-testid="org-list" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{orgs.map((org) => <Link key={org.id} data-testid="org-card" data-org-id={org.id} href={`/orgs/${org.id}`} className="rounded-2xl border bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><h2 data-testid="org-card-name" className="font-semibold text-slate-950">{org.name}</h2><p className="mt-1 text-sm text-slate-500">/{org.slug}</p>{org.description && <p className="mt-4 line-clamp-2 text-sm text-slate-600">{org.description}</p>}</Link>)}</div>}
  </main></div>;
}
