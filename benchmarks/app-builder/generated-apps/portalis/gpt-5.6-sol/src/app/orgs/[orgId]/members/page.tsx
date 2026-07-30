import { headers } from "next/headers";
import { MemberManagement } from "@/components/member-management";
import { NotAuthorized, OrgShell } from "@/components/org-shell";
import { getAuthorizedOrganization, getOrganizationInvites, getOrganizationMembers } from "@/lib/organizations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrganizationMembers({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await requireUser();
  const { orgId } = await params;
  const organization = await getAuthorizedOrganization(orgId, user.id);
  if (!organization || organization.role !== "org_admin") return <NotAuthorized />;
  const [members, invites, requestHeaders] = await Promise.all([getOrganizationMembers(orgId), getOrganizationInvites(orgId), headers()]);
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")!).split(",")[0].trim();
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0].trim() ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return <OrgShell organization={organization}><MemberManagement orgId={orgId} members={members} invites={invites} origin={origin} /></OrgShell>;
}
