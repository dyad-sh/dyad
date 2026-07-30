import { redirect } from "next/navigation";
import { TicketsList } from "@/components/tickets-list";
import { dashboardPath, getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in");
  if (user.role !== "requester") redirect(dashboardPath(user.role));
  return <TicketsList />;
}
