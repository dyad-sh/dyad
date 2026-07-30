import { FolderKanban, Settings, Users } from "lucide-react";
import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotAuthorized, OrgShell } from "@/components/org-shell";
import { getAuthorizedOrganization } from "@/lib/organizations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrganizationOverview({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser(); const { orgId } = await params; const organization = await getAuthorizedOrganization(orgId, user.id);
  if (!organization) return <NotAuthorized />;
  return <OrgShell organization={organization}><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"><Link href={`/orgs/${orgId}/projects`}><Card className="h-full bg-white shadow-sm transition hover:border-sky-200"><CardHeader><FolderKanban className="mb-3 size-6 text-sky-700" /><CardTitle>Projects</CardTitle><CardDescription>View and manage this organization&apos;s projects.</CardDescription></CardHeader></Card></Link>{organization.role === "org_admin" && <><Link href={`/orgs/${orgId}/settings`}><Card className="h-full bg-white shadow-sm transition hover:border-sky-200"><CardHeader><Settings className="mb-3 size-6 text-sky-700" /><CardTitle>Organization settings</CardTitle><CardDescription>Update your organization profile.</CardDescription></CardHeader></Card></Link><Link href={`/orgs/${orgId}/members`}><Card className="h-full bg-white shadow-sm transition hover:border-sky-200"><CardHeader><Users className="mb-3 size-6 text-sky-700" /><CardTitle>Members</CardTitle><CardDescription>Manage people, roles, and invitations.</CardDescription></CardHeader></Card></Link></>}</div></OrgShell>;
}
