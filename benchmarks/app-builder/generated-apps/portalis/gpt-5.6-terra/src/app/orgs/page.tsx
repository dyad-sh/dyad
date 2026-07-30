import Link from "next/link";
import { PageShell } from "@/components/portal-header";
import { sql } from "@/db";
import { requireUser } from "@/lib/organizations";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const user = await requireUser();
  const organizations = await sql`
    SELECT o.id, o.name, o.slug, o.description
    FROM organizations o
    INNER JOIN organization_memberships m ON m.org_id = o.id
    WHERE m.user_id = ${user.id}::uuid
    ORDER BY o.created_at DESC
  `;

  return <PageShell>

    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-sm font-medium text-sky-700">Workspace directory</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Your organizations</h1><p className="mt-2 text-slate-500">Choose an organization to manage its workspace.</p></div><Link href="/orgs/new" className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-700">Create organization</Link></div>
    {organizations.length === 0 ? <section data-testid="orgs-empty-state" className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><h2 className="text-lg font-semibold">No organizations yet</h2><p className="mt-2 text-sm text-slate-500">Create your first workspace to get started.</p><Link data-testid="create-org-link" href="/orgs/new" className="mt-5 inline-block font-medium text-sky-700 hover:text-sky-900">Create an organization →</Link></section> : <div data-testid="org-list" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{organizations.map((organization) => <Link key={organization.id} href={`/orgs/${organization.id}`} data-testid="org-card" data-org-id={organization.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"><h2 data-testid="org-card-name" className="font-semibold">{organization.name}</h2><p className="mt-1 text-sm text-slate-500">{organization.slug}</p>{organization.description && <p className="mt-4 line-clamp-2 text-sm text-slate-600">{organization.description}</p>}</Link>)}</div>}
  </PageShell>;
}
