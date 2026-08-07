import { redirect } from "next/navigation";
import { CannedResponses } from "@/components/canned-responses";
import { DeactivatedNotice } from "@/components/deactivated-notice";
import { dashboardPath, getSessionAccount } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function CannedPage() {
  const user = await getSessionAccount();
  if (!user) redirect("/auth/sign-in");
  if (!user.active) return <DeactivatedNotice />;
  if (user.role !== "admin") redirect(dashboardPath(user.role));
  return <CannedResponses />;
}
