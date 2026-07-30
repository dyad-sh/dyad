import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { dashboardPath, getSessionUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in");
  if (!user.active) redirect("/auth/deactivated");
  if (user.role !== "admin") redirect(dashboardPath(user.role));

  return <div className="min-h-screen bg-slate-50"><AppHeader user={user} /><main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">{children}</main></div>;
}
