import { redirect } from "next/navigation";
import { TicketsList } from "@/components/tickets-list";
import { DeactivatedNotice } from "@/components/deactivated-notice";
import { dashboardPath, getSessionAccount } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const account = await getSessionAccount();
  if (!account) redirect("/auth/sign-in");
  if (!account.active) return <DeactivatedNotice />;
  if (account.role !== "requester") redirect(dashboardPath(account.role));
  return <TicketsList />;
}
