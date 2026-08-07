import { redirect } from "next/navigation";
import { AgentDashboard } from "@/components/agent-dashboard";
import { DeactivatedNotice } from "@/components/deactivated-notice";
import { dashboardPath, getSessionAccount } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const user = await getSessionAccount();
  if (!user) redirect("/auth/sign-in");
  if (!user.active) return <DeactivatedNotice />;
  if (user.role === "requester") redirect(dashboardPath(user.role));
  return <AgentDashboard />;
}
