import { sql } from "@/db";
import { getWorkspaceContext } from "@/lib/workspace";
import { InvitesList } from "@/components/invites-list";

type Invite = { id: string; email: string; workspaceId: string; workspaceName: string };

export default async function InvitesPage() {
  const context = (await getWorkspaceContext())!;
  const invites = await sql`SELECT i.id, i.email, w.id AS "workspaceId", w.name AS "workspaceName" FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id WHERE lower(i.email) = ${context.user.email.toLowerCase()} AND i.status = 'pending' ORDER BY i.created_at DESC` as Invite[];
  return <div className="mx-auto max-w-3xl"><div className="mb-8"><p className="text-sm font-medium text-indigo-600">Collaboration</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Workspace invites</h1><p className="mt-2 text-sm text-slate-500">Join teams that have invited your email address.</p></div><InvitesList initialInvites={invites} /></div>;
}
