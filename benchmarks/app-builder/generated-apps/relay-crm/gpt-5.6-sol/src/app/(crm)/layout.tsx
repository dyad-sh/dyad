import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const context = await getWorkspaceContext();
  if (!context) redirect("/auth/sign-in");
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader email={context.user.email} memberships={context.memberships} activeWorkspaceId={context.activeWorkspace.id} />
      <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10">{children}</main>
    </div>
  );
}
