import Link from "next/link";
import { Activity, ArrowLeft, BarChart3, FolderKanban, KeyRound, Settings, Users } from "lucide-react";
import type { OrganizationAccess } from "@/lib/organizations";

const navClass = "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-white hover:text-slate-950";

export function OrgShell({ organization, children }: { organization: OrganizationAccess; children: React.ReactNode }) {
  const base = `/orgs/${organization.id}`;
  return <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8"><Link href="/orgs" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" />All organizations</Link><div className="mb-8 flex flex-col gap-5 border-b pb-6"><div><p className="text-xs font-semibold uppercase tracking-widest text-sky-700">Organization</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950" data-testid="org-header-name">{organization.name}</h1></div><nav className="flex flex-wrap gap-1"><Link href={`${base}/projects`} className={navClass}><FolderKanban className="size-4" />Projects</Link><Link href={`${base}/usage`} className={navClass} data-testid="nav-usage"><BarChart3 className="size-4" />Usage</Link>{organization.role === "org_admin" && <><Link href={`${base}/settings`} className={navClass} data-testid="nav-settings"><Settings className="size-4" />Settings</Link><Link href={`${base}/members`} className={navClass} data-testid="nav-members"><Users className="size-4" />Members</Link><Link href={`${base}/audit`} className={navClass} data-testid="nav-audit"><Activity className="size-4" />Audit</Link><Link href={`${base}/api-keys`} className={navClass} data-testid="nav-api-keys"><KeyRound className="size-4" />API keys</Link></>}</nav></div>{children}</main>;
}

export function NotAuthorized() {
  return <main className="mx-auto max-w-3xl px-4 py-24 text-center"><div className="rounded-2xl border bg-white p-10 shadow-sm" data-testid="not-authorized"><h1 className="text-2xl font-bold text-slate-950">Not authorized</h1><p className="mt-2 text-slate-500">You do not have access to this area.</p><Link href="/orgs" className="mt-6 inline-block font-semibold text-sky-700 hover:text-sky-800">Return to organizations</Link></div></main>;
}
