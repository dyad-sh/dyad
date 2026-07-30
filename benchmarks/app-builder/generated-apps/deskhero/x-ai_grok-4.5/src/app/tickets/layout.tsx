import { AppShell } from "@/components/app-shell";
import { requirePageUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function TicketsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Any signed-in role can reach ticket pages for owns that they can view:
  // requesters see their list; agents/admins open detail links from queues.
  await requirePageUser();

  return <AppShell>{children}</AppShell>;
}
