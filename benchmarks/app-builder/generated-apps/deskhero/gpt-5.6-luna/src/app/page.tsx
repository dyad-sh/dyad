import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getActor();
  if (!user) redirect("/auth/sign-in");
  redirect(user.role === "admin" ? "/admin" : user.role === "agent" ? "/agent" : "/tickets");
}
