import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { SiteHeader } from "@/components/site-header";
import { DeactivatedNotice } from "@/components/deactivated-notice";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/sign-in");
  }
  if (user.active && user.role !== "admin") {
    redirect(user.role === "agent" ? "/agent" : "/tickets");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        {user.active ? children : <DeactivatedNotice />}
      </main>
    </div>
  );
}
