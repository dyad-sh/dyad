import { redirect } from "next/navigation";
import { AccountDeactivated } from "@/components/account-deactivated";
import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export default async function TicketsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in");
  if (!user.active) return <AccountDeactivated />;

  return (
    <AppShell email={user.email} role={user.role}>
      {children}
    </AppShell>
  );
}
