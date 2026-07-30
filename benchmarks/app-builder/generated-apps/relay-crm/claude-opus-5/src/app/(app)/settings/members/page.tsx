import { InviteForm } from "@/components/invite-form";
import { MemberRowActions } from "@/components/member-row-actions";
import { listMembers, listWorkspaceInvites } from "@/lib/members";
import { canManageMembers } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const ctx = await pageWorkspaceContext();

  if (!canManageMembers(ctx.role)) {
    return (
      <div
        data-testid="forbidden-message"
        className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900"
      >
        Only the workspace owner can manage members.
      </div>
    );
  }

  const [members, invites] = await Promise.all([
    listMembers(ctx.workspaceId),
    listWorkspaceInvites(ctx.workspaceId),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Members
        </h1>
        <p className="mt-1 text-sm text-slate-500">{ctx.workspaceName}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Team
        </h2>
        <div
          data-testid="members-list"
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          <ul className="divide-y divide-slate-100">
            {members.map((m) => (
              <li
                key={m.id}
                data-testid="member-row"
                data-user-id={m.userId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              >
                <span
                  data-testid="member-row-email"
                  className="text-sm text-slate-900"
                >
                  {m.email}
                </span>
                <span
                  data-testid="member-row-role"
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-600"
                >
                  {m.role}
                </span>
                <div className="ml-auto">
                  <MemberRowActions
                    workspaceId={ctx.workspaceId}
                    memberId={m.id}
                    role={m.role}
                    isSelf={m.userId === ctx.user.id}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <InviteForm workspaceId={ctx.workspaceId} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Pending invites
        </h2>
        <div
          data-testid="pending-invites-list"
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          {invites.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              No pending invites.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {invites.map((i) => (
                <li
                  key={i.id}
                  data-testid="pending-invite-row"
                  className="flex items-center gap-4 px-4 py-3"
                >
                  <span
                    data-testid="pending-invite-email"
                    className="text-sm text-slate-900"
                  >
                    {i.email}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600">
                    {i.role}
                  </span>
                  <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    pending
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
