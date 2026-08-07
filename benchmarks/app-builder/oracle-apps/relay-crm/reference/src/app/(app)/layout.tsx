import { AppHeader } from "@/components/app-header";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await pageWorkspaceContext();

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader
        email={ctx.user.email}
        role={ctx.role}
        activeWorkspaceId={ctx.workspaceId}
        workspaces={ctx.memberships.map((m) => ({
          id: m.workspaceId,
          name: m.workspaceName,
        }))}
      />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
