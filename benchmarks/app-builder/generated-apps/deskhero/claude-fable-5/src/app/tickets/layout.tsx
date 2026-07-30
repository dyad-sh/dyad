import { getSessionWithRole } from "@/lib/roles";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AccountDeactivated } from "@/components/account-deactivated";

export const dynamic = "force-dynamic";

export default async function TicketsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionWithRole();
  if (!ctx) redirect("/auth/sign-in");
  if (!ctx.active) {
    return (
      <AppShell>
        <AccountDeactivated />
      </AppShell>
    );
  }
  return <AppShell>{children}</AppShell>;
}
