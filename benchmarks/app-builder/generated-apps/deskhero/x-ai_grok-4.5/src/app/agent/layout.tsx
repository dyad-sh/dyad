import { AppShell } from "@/components/app-shell";
import { requirePageUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePageUser({ roles: ["admin", "agent"] });
  return <AppShell>{children}</AppShell>;
}
