import { NotAuthorized, PageShell } from "@/components/portal-header";
import { OrgShell } from "@/components/org-shell";
import { requireOrgMember } from "@/lib/organizations";
import { updateOrganization } from "../../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { orgId } = await params;
  const { saved, error } = await searchParams;
  const { organization, role } = await requireOrgMember(orgId);
  if (!organization || role !== "org_admin") return <NotAuthorized />;
  const save = updateOrganization.bind(null, orgId);

  return <PageShell><OrgShell org={organization} role={role!}><form action={save} className="mt-8 max-w-2xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Profile settings</h2><label className="block text-sm font-medium">Name<input data-testid="settings-name-input" name="name" required defaultValue={organization.name} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100" /></label><label className="block text-sm font-medium">Description<textarea data-testid="settings-description-input" name="description" defaultValue={organization.description} rows={4} className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100" /></label>{error && <p className="text-sm text-red-700">{error}</p>}{saved && <p data-testid="settings-saved" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Settings saved.</p>}<button data-testid="settings-save" className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-700">Save changes</button></form></OrgShell></PageShell>;

}
