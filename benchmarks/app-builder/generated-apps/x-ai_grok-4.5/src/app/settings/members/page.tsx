import { redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { InviteMemberForm } from "@/components/settings/invite-member-form";
import { MemberRowActions } from "@/components/settings/member-row-actions";
import type { MembershipRole } from "@/lib/types";

export const dynamic = "force-dynamic";

type MemberRow = {
  id: string;
  user_id: string;
  email: string;
  role: MembershipRole;
};

type InviteRow = {
  id: string;
  email: string;
  role: string;
};

export default async function MembersSettingsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);

  if (!isOwner(context.role)) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p
          data-testid="forbidden-message"
          className="rounded-lg border border-red-100 bg-red-50 px-4 py-6 text-sm text-red-700"
        >
          Only workspace owners can manage members.
        </p>
      </div>
    );
  }

  const members = (await sql`
    SELECT id, user_id, email, role
    FROM workspace_members
    WHERE workspace_id = ${context.workspaceId}
    ORDER BY
      CASE WHEN role = 'owner' THEN 0 WHEN role = 'member' THEN 1 ELSE 2 END,
      created_at ASC
  `) as MemberRow[];

  const pendingInvites = (await sql`
    SELECT id, email, role
    FROM workspace_invites
    WHERE workspace_id = ${context.workspaceId} AND status = 'pending'
    ORDER BY created_at DESC
  `) as InviteRow[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-slate-500">
          People with access to {context.workspaceName}.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Team</h2>
        <div data-testid="members-list">
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {members.map((member) => (
              <li
                key={member.id}
                data-testid="member-row"
                data-user-id={member.user_id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <span data-testid="member-row-email" className="text-sm text-slate-900">
                    {member.email || member.user_id}
                  </span>
                  <p
                    data-testid="member-row-role"
                    className="mt-0.5 text-xs font-medium capitalize text-slate-500"
                  >
                    {member.role}
                  </p>
                </div>
                <MemberRowActions
                  workspaceId={context.workspaceId}
                  memberId={member.id}
                  currentRole={member.role}
                  isSelf={member.user_id === user.id}
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Invite someone</h2>
        <InviteMemberForm workspaceId={context.workspaceId} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Pending invites</h2>
        <div data-testid="pending-invites-list">
          {pendingInvites.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              No pending invites.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {pendingInvites.map((invite) => (
                <li
                  key={invite.id}
                  data-testid="pending-invite-row"
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span
                    data-testid="pending-invite-email"
                    className="text-sm text-slate-900"
                  >
                    {invite.email}
                  </span>
                  <span className="text-xs capitalize text-slate-500">{invite.role}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
