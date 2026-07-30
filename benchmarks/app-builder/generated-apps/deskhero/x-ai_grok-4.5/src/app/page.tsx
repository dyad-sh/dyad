import { redirect } from "next/navigation";

import { homePathForRole } from "@/lib/roles";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    if (!user.active) {
      redirect("/account-deactivated");
    }
    redirect(homePathForRole(user.role));
  }

  redirect("/auth/sign-in");
}
