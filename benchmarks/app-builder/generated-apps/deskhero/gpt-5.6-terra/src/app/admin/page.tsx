import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { dashboardPath, getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in");
  if (user.role !== "admin") redirect(dashboardPath(user.role));
  return <AdminDashboard />;
}
