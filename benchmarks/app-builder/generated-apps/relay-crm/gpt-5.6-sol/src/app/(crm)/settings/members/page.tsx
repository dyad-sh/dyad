import { sql } from "@/db";
import { getWorkspaceContext, type WorkspaceRole } from "@/lib/workspace";
import { InviteForm } from "@/components/invite-form";
import { MemberManager } from "@/components/member-manager";

type Member = { id: string; userId: string; email: string; role: WorkspaceRole };
type Invite = { id: string; email: string; role: "member" | "viewer" };

export default async function MembersPage() {
  const context = (await getWorkspaceContext())!;
  if (context.activeWorkspace.role !== "owner") return <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-900" data-testid="forbidden-message"><h1 className="text-xl font-semibold">Owner access required</h1><p className="mt-2 text-sm">Only workspace owners can manage members and invitations.</p></div>;
  const workspaceId = context.activeWorkspace.id;
  const members = await sql`SELECT id, user_id AS "userId", email, role FROM workspace_memberships WHERE workspace_id = ${workspaceId} ORDER BY created_at` as Member[];
  const invites = await sql`SELECT id, email, role FROM workspace_invites WHERE workspace_id = ${workspaceId} AND status = 'pending' ORDER BY created_at DESC` as Invite[];
  return <div className="mx-auto max-w-4xl"><div className="mb-8"><p className="text-sm font-medium text-indigo-600">{context.activeWorkspace.name}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Members</h1><p className="mt-2 text-sm text-slate-500">Manage who can access this workspace.</p></div><InviteForm workspaceId={workspaceId} /><section className="mt-6"><h2 className="mb-3 font-semibold text-slate-950">Workspace members</h2><MemberManager workspaceId={workspaceId} currentUserId={context.user.id} initialMembers={members} /></section><section className="mt-6"><h2 className="mb-3 font-semibold text-slate-950">Pending invites</h2><div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="pending-invites-list">{invites.map((invite) => <div key={invite.id} className="flex justify-between border-b border-slate-100 p-5 last:border-0" data-testid="pending-invite-row"><span className="text-sm text-slate-700" data-testid="pending-invite-email">{invite.email}</span><span className="text-xs font-semibold capitalize text-slate-400">{invite.role}</span></div>)}{!invites.length && <p className="p-5 text-sm text-slate-500">No pending invites.</p>}</div></section></div>;
}
