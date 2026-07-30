import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotAuthorized, OrgShell } from "@/components/org-shell";
import { ProjectForm } from "@/components/project-form";
import { getAuthorizedOrganization } from "@/lib/organizations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic"; export const revalidate = 0;

export default async function NewProjectPage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser(); const { orgId } = await params; const organization = await getAuthorizedOrganization(orgId, user.id); if (!organization) return <NotAuthorized />;
  return <OrgShell organization={organization}><Card className="max-w-2xl bg-white shadow-sm"><CardHeader><CardTitle>Create project</CardTitle><CardDescription>This project will belong only to {organization.name}.</CardDescription></CardHeader><CardContent><ProjectForm orgId={orgId} /></CardContent></Card></OrgShell>;
}
