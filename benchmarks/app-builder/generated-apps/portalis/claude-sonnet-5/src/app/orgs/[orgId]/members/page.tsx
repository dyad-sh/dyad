import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { getMembership, getOrgById, getOrgMembers } from "@/lib/orgs";
import { getOrgInvites } from "@/lib/invites";
import { MembersPanel } from "./members-panel";

export const dynamic = "force-dynamic";

export default async function OrgMembersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const org = await getOrgById(orgId);
  const membership = org
    ? await getMembership(orgId, session.user.id)
    : undefined;

  if (!org || !membership) {
    return null;
  }

  const isAdmin = membership.role === "org_admin";
  const members = await getOrgMembers(orgId);
  const invites = isAdmin ? await getOrgInvites(orgId) : [];

  const headersList = await headers();
  const host = headersList.get("host") ?? "";
  const proto = headersList.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;

  return (
    <MembersPanel
      orgId={orgId}
      members={members}
      invites={invites}
      currentUserId={session.user.id}
      isAdmin={isAdmin}
      origin={origin}
    />
  );
}
