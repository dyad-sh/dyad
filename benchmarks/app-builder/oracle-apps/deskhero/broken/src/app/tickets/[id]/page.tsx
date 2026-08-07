import { redirect } from "next/navigation";
import { TicketDetail } from "@/components/ticket-detail";
import { DeactivatedNotice } from "@/components/deactivated-notice";
import { getSessionAccount } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const account = await getSessionAccount();
  if (!account) redirect("/auth/sign-in");
  if (!account.active) return <DeactivatedNotice />;
  const { id } = await params;
  return <TicketDetail id={id} />;
}
