import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/api-auth";
import { dashboardPathFor } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect(dashboardPathFor(user.role));
  redirect("/auth/sign-in");
}
