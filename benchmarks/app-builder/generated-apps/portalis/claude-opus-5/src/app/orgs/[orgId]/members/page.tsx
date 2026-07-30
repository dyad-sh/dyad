import { NotAuthorized } from "@/components/not-authorized";
import { getRequestOrigin } from "@/lib/origin";
import {
  getOrgForMember,
  listOrgInvites,
  listOrgMembers,
  requireUser,
} from "@/lib/orgs";
import { MembersManager } from "./members-manager";

export const dynamic = "force-dynamic";

export default async function OrgMembersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireUser();
  const membership = await getOrgForMember(orgId, user.id);
  if (!membership) return <NotAuthorized />;

  const { org, role } = membership;
  const isAdmin = role === "org_admin";
  const [members, invites, origin] = await Promise.all([
    listOrgMembers(org.id),
    isAdmin ? listOrgInvites(org.id) : Promise.resolve([]),
    getRequestOrigin(),
  ]);

  return (
    <MembersManager
      orgId={org.id}
      orgName={org.name}
      viewerRole={role}
      viewerId={user.id}
      members={members}
      invites={invites}
      origin={origin}
    />
  );
}
