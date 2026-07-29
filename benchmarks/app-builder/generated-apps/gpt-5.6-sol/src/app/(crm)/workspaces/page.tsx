import { canWriteRecords, getWorkspaceContext } from "@/lib/workspace";
import { WorkspacesPanel } from "@/components/workspaces-panel";

export default async function WorkspacesPage() {
  const context = (await getWorkspaceContext())!;
  const workspaces = context.memberships.map((membership) => ({ id: membership.workspaceId, name: membership.workspaceName }));
  return <WorkspacesPanel initialWorkspaces={workspaces} canCreate={canWriteRecords(context)} />;
}
