import { redirect } from "next/navigation";
import { AccountDeactivated } from "@/components/account-deactivated";
import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/lib/api-auth";
import { dashboardPathFor } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in");
  if (!user.active) return <AccountDeactivated />;
  if (user.role !== "admin") redirect(dashboardPathFor(user.role));

  return (
    <AppShell email={user.email} role={user.role}>
      {children}
    </AppShell>
  );
}
