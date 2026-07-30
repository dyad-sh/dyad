import { InviteForm } from "@/components/orgs/invite-form";
import { MemberRowActions } from "@/components/orgs/member-row-actions";
import { PendingInvitesTable } from "@/components/orgs/pending-invites-table";
import { NotAuthorized } from "@/components/not-authorized";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPendingInvites } from "@/lib/invites";
import { getOrgMembers, requireOrgAccess } from "@/lib/orgs";
import { getRequestOrigin } from "@/lib/request-origin";
import { isOrgAdmin } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function OrgMembersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const access = await requireOrgAccess(orgId);

  if (!access) {
    return <NotAuthorized />;
  }

  const members = await getOrgMembers(orgId);
  const admin = isOrgAdmin(access.membership.role);
  const origin = await getRequestOrigin();

  const pendingInvites = admin ? await listPendingInvites(orgId) : [];
  const inviteRows = pendingInvites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    status: invite.status,
    acceptUrl: `${origin}/invite/${invite.token}`,
  }));

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Members</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              People with access to this organization.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            <span data-testid="member-count">{members.length}</span>{" "}
            {members.length === 1 ? "member" : "members"}
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
          <Table data-testid="members-table">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                {admin ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow
                  key={member.id}
                  data-testid="member-row"
                  data-member-email={member.email}
                  data-user-id={member.user_id}
                >
                  <TableCell data-testid="member-email" className="font-medium">
                    {member.email}
                  </TableCell>
                  <TableCell data-testid="member-role">{member.role}</TableCell>
                  {admin ? (
                    <TableCell className="text-right">
                      <MemberRowActions
                        orgId={orgId}
                        userId={member.user_id}
                        role={member.role}
                        isSelf={member.user_id === access.user.id}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {admin ? (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">
              Invite people
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a pending invite and share the accept link.
            </p>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
            <InviteForm orgId={orgId} />
          </div>
          <div>
            <h3 className="mb-3 text-lg font-semibold tracking-tight">
              Pending invites
            </h3>
            <PendingInvitesTable orgId={orgId} invites={inviteRows} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
