import { WorkspacesPanel } from "@/components/workspaces-panel";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const ctx = await pageWorkspaceContext();

  return (
    <WorkspacesPanel
      activeId={ctx.workspaceId}
      workspaces={ctx.memberships.map((m) => ({
        id: m.workspaceId,
        name: m.workspaceName,
        role: m.role,
      }))}
    />
  );
}
