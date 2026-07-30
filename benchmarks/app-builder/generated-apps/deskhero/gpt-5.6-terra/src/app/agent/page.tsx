import { redirect } from "next/navigation";
import { AgentDashboard } from "@/components/agent-dashboard";
import { dashboardPath, getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in");
  if (user.role === "requester") redirect(dashboardPath(user.role));
  return <AgentDashboard />;
}
