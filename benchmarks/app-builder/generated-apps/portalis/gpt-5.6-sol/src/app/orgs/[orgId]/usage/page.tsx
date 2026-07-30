import { Activity, FolderKanban, KeyRound, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotAuthorized, OrgShell } from "@/components/org-shell";
import { getUsageCounts } from "@/lib/admin-data";
import { getAuthorizedOrganization } from "@/lib/organizations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic"; export const revalidate = 0;

export default async function UsagePage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser(); const { orgId } = await params; const organization = await getAuthorizedOrganization(orgId, user.id); if (!organization) return <NotAuthorized />; const usage = await getUsageCounts(orgId);
  const items = [{ label: "Projects", value: usage.projects, testid: "usage-projects-count", icon: FolderKanban }, { label: "Members", value: usage.members, testid: "usage-members-count", icon: Users }, { label: "Active API keys", value: usage.apiKeys, testid: "usage-api-keys-count", icon: KeyRound }, { label: "Audit events", value: usage.events, testid: "usage-events-count", icon: Activity }];
  return <OrgShell organization={organization}><div className="mb-6"><h2 className="text-xl font-semibold text-slate-950">Usage</h2><p className="mt-1 text-sm text-slate-500">A current snapshot of this organization.</p></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{items.map((item) => <Card key={item.label} className="bg-white shadow-sm"><CardHeader className="flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium text-slate-600">{item.label}</CardTitle><item.icon className="size-4 text-sky-700" /></CardHeader><CardContent><p className="text-3xl font-bold text-slate-950" data-testid={item.testid}>{item.value}</p></CardContent></Card>)}</div></OrgShell>;
}
