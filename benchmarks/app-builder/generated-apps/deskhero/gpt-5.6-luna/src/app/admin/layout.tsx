import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/roles";
import { TicketHeader } from "@/components/ticket-header";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getActor();
  if (!user) redirect("/auth/sign-in");
  if (user.role !== "admin") redirect(user.role === "agent" ? "/agent" : "/tickets");
  return <div className="min-h-screen bg-slate-50"><TicketHeader />{children}</div>;
}
