import { redirect } from "next/navigation";
import Link from "next/link";
import { TicketForm } from "@/components/ticket-form";
import { DeactivatedNotice } from "@/components/deactivated-notice";
import { dashboardPath, getSessionAccount } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function NewTicketPage() {
  const user = await getSessionAccount();
  if (!user) redirect("/auth/sign-in");
  if (!user.active) return <DeactivatedNotice />;
  if (user.role !== "requester") redirect(dashboardPath(user.role));
  return <main className="mx-auto max-w-3xl px-5 py-10"><Link href="/tickets" className="text-sm font-medium text-cyan-700 hover:text-cyan-800">← Back to tickets</Link><div className="mt-7 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><p className="text-sm font-medium text-cyan-700">New request</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Create a ticket</h1><p className="mt-2 text-sm text-slate-500">Tell us what you need and set an appropriate priority.</p><div className="mt-8"><TicketForm /></div></div></main>;
}
