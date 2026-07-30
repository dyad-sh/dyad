import { AcceptInviteButton } from "@/components/accept-invite-button";
import { listInvitesForEmail } from "@/lib/members";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function InvitesPage() {
  const ctx = await pageWorkspaceContext();
  const invites = await listInvitesForEmail(ctx.user.email);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Invites
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Workspaces that have invited {ctx.user.email}.
        </p>
      </div>

      <div
        data-testid="invites-list"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        {invites.length === 0 ? (
          <p
            data-testid="invites-empty"
            className="px-4 py-10 text-center text-sm text-slate-500"
          >
            No pending invites.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {invites.map((i) => (
              <li
                key={i.id}
                data-testid="invite-row"
                className="flex items-center gap-4 px-4 py-3"
              >
                <span
                  data-testid="invite-row-workspace"
                  className="text-sm font-medium text-slate-900"
                >
                  {i.workspaceName}
                </span>
                <span className="text-sm text-slate-500">{i.email}</span>
                <AcceptInviteButton inviteId={i.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
