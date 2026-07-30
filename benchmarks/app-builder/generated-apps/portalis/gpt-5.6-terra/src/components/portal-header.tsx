import Link from "next/link";
import { UserMenu } from "@/components/user-menu";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export async function PortalHeader() {
  const { data: session } = await auth.getSession();
  const organizations = session?.user ? await sql`
    SELECT o.id, o.name
    FROM organizations o
    INNER JOIN organization_memberships m ON m.org_id = o.id
    WHERE m.user_id = ${session.user.id}::uuid
    ORDER BY o.name
  ` : [];

  return <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8"><div className="flex items-center gap-5"><Link href="/orgs" className="flex items-center gap-2 font-semibold tracking-tight text-slate-950"><span className="grid size-8 place-items-center rounded-lg bg-sky-500 text-sm text-white">P</span>Portalis</Link><div data-testid="org-switcher" className="hidden items-center gap-1 text-sm sm:flex">{organizations.map((organization) => <Link key={organization.id} href={`/orgs/${organization.id}`} data-testid="org-switcher-option" data-org-id={organization.id} className="max-w-36 truncate rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900">{organization.name}</Link>)}</div></div>{session?.user && <UserMenu email={session.user.email} />}</div></header>;
}

export async function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50 text-slate-900"><PortalHeader /><main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">{children}</main></div>;
}

export async function NotAuthorized() {
  return <PageShell><section data-testid="not-authorized" className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-semibold">You don’t have access to this organization</h1><p className="mt-2 text-sm text-slate-500">Ask an organization administrator to add you as a member.</p><Link href="/orgs" className="mt-6 inline-block rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white">Back to organizations</Link></section></PageShell>;
}
