import { getSessionWithRole } from "@/lib/roles";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ctx = await getSessionWithRole();
  if (!ctx) redirect("/auth/sign-in");
  redirect(
    ctx.role === "admin" ? "/admin" : ctx.role === "agent" ? "/agent" : "/tickets",
  );
}
