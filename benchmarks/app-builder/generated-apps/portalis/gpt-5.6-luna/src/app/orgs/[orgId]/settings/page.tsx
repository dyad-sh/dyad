import Link from "next/link";
import { PortalHeader } from "@/components/portal-header";
import { getMemberOrg, requireUser } from "@/lib/orgs";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser();
  const { orgId } = await params;
  const org = await getMemberOrg(orgId, user.id);
  if (!org || org.role !== "org_admin") return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-3xl px-6 py-16"><div data-testid="not-authorized" className="rounded-2xl border bg-white p-10 text-center"><h1 className="text-2xl font-semibold text-slate-950">Not authorized</h1><p className="mt-2 text-slate-500">Only organization admins can access settings.</p><Link href="/orgs" className="mt-6 inline-block text-sm font-medium text-blue-600 hover:underline">Back to organizations</Link></div></main></div>;

  return <div className="min-h-screen bg-slate-50"><PortalHeader email={user.email} /><main className="mx-auto max-w-3xl px-6 py-10"><Link href={`/orgs/${org.id}`} className="text-sm font-medium text-blue-600 hover:underline">← Back to {org.name}</Link><section className="mt-6 rounded-2xl border bg-white p-8 shadow-sm"><p className="text-sm font-medium text-blue-600">Organization settings</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Profile</h1><p className="mt-2 text-sm text-slate-500">Keep your workspace details up to date.</p><div className="mt-8"><SettingsForm orgId={org.id} name={org.name} description={org.description} /></div></section></main></div>;
}
