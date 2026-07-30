import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotAuthorized, OrgShell } from "@/components/org-shell";
import { SettingsForm } from "@/components/settings-form";
import { getAuthorizedOrganization } from "@/lib/organizations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrganizationSettings({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser();
  const { orgId } = await params;
  const organization = await getAuthorizedOrganization(orgId, user.id);
  if (!organization || organization.role !== "org_admin") return <NotAuthorized />;
  return <OrgShell organization={organization}><Card className="max-w-2xl bg-white shadow-sm"><CardHeader><CardTitle>Profile settings</CardTitle><CardDescription>Changes appear anywhere your organization is shown.</CardDescription></CardHeader><CardContent><SettingsForm organization={organization} /></CardContent></Card></OrgShell>;
}
