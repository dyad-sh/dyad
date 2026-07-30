import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { ensureUserWorkspace } from "@/lib/workspace";
import { WorkspaceCreateForm } from "@/components/workspaces/workspace-create-form";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
          <p className="mt-1 text-sm text-slate-500">
            Switch between teams or create a new workspace.
          </p>
        </div>
        <WorkspaceCreateForm />
      </div>

      <div data-testid="workspace-list">
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {context.memberships.map((membership) => (
            <li
              key={membership.membershipId}
              data-testid="workspace-row"
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p
                  data-testid="workspace-row-name"
                  className="font-medium text-slate-900"
                >
                  {membership.workspaceName}
                </p>
                <p className="text-sm text-slate-500 capitalize">{membership.role}</p>
              </div>
              {membership.workspaceId === context.workspaceId ? (
                <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">
                  Active
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
