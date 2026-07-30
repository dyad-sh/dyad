import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  if (!user.active) {
    redirect("/tickets");
  }

  if (user.role === "admin") {
    redirect("/admin");
  } else if (user.role === "agent") {
    redirect("/agent");
  } else {
    redirect("/tickets");
  }
}
