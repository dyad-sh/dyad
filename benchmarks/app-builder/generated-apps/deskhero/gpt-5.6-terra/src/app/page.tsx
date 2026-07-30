import { redirect } from "next/navigation";
import { dashboardPath, getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? dashboardPath(user.role) : "/auth/sign-in");
}
