import { redirect } from "next/navigation";

import { dashboardPath, getSessionUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in");
  if (!user.active) redirect("/auth/deactivated");
  redirect(dashboardPath(user.role));
}
