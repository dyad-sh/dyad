import Link from "next/link";
import { ArrowRight, Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrganizations } from "@/lib/organizations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrganizationsPage() {
  const user = await requireUser();
  const organizations = await getOrganizations(user.id);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div><p className="text-sm font-semibold text-sky-700">Workspace</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Organizations</h1><p className="mt-2 text-slate-500">Choose an organization to manage its profile and members.</p></div>
        {organizations.length > 0 && <Button asChild className="bg-sky-600 hover:bg-sky-700"><Link href="/orgs/new"><Plus />New organization</Link></Button>}
      </div>

      {organizations.length === 0 ? (
        <Card className="border-dashed bg-white shadow-sm" data-testid="orgs-empty-state"><CardContent className="flex flex-col items-center px-6 py-16 text-center"><span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-700"><Building2 /></span><h2 className="text-xl font-semibold text-slate-950">Create your first organization</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Organizations keep your settings and team members together in one secure place.</p><Button asChild className="mt-6 bg-sky-600 hover:bg-sky-700"><Link href="/orgs/new" data-testid="create-org-link"><Plus />Create organization</Link></Button></CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="org-list">
          {organizations.map((organization) => <Link key={organization.id} href={`/orgs/${organization.id}`} className="group" data-testid="org-card" data-org-id={organization.id}><Card className="h-full bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md"><CardHeader><div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 group-hover:bg-sky-50 group-hover:text-sky-700"><Building2 className="size-5" /></div><CardTitle data-testid="org-card-name">{organization.name}</CardTitle><CardDescription>{organization.description || `@${organization.slug}`}</CardDescription></CardHeader><CardContent className="flex items-center gap-2 text-sm font-semibold text-sky-700">Open organization <ArrowRight className="size-4 transition group-hover:translate-x-1" /></CardContent></Card></Link>)}
        </div>
      )}
    </main>
  );
}
