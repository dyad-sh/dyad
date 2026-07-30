import Link from "next/link";
import { PageShell } from "@/components/portal-header";
import { requireUser } from "@/lib/organizations";
import { createOrganization } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewOrganizationPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser();
  const { error } = await searchParams;
  return <PageShell>

    <div className="mx-auto max-w-xl"><Link href="/orgs" className="text-sm font-medium text-sky-700 hover:text-sky-900">← Organizations</Link><h1 className="mt-5 text-3xl font-semibold tracking-tight">Create organization</h1><p className="mt-2 text-slate-500">Set up a workspace for your team.</p>
      <form action={createOrganization} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><label className="block text-sm font-medium">Organization name<input data-testid="org-name-input" name="name" required className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100" /></label><label className="block text-sm font-medium">Slug<input data-testid="org-slug-input" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Use lowercase letters, numbers, and hyphens." className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100" /><span className="mt-2 block text-xs font-normal text-slate-500">Lowercase letters, numbers, and hyphens only.</span></label>{error && <p data-testid="create-org-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<button data-testid="create-org-submit" className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-700">Create organization</button></form>
    </div>
  </PageShell>;
}
