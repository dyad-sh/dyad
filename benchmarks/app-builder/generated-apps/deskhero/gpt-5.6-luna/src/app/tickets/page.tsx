"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Ticket = { id: string; subject: string; priority: "low" | "medium" | "high"; status: string; overdue: boolean; created_at: string };

export default function TicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/me").then((response) => response.json()).then((profile) => { if (profile.role === "admin") router.replace("/admin"); else if (profile.role === "agent") router.replace("/agent"); }); fetch("/api/tickets").then((response) => response.json()).then(setTickets).finally(() => setLoading(false)); }, [router]);
  return <main className="mx-auto max-w-5xl px-6 py-12"><div className="mb-10 flex items-end justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-600">Your workspace</p><h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">My tickets</h1><p className="mt-2 text-slate-500">Track questions, requests, and issues in one place.</p></div><Link data-testid="new-ticket-link" href="/tickets/new" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-700">New ticket</Link></div>
    {loading ? <p className="text-slate-500">Loading tickets…</p> : <div data-testid="ticket-list" className="space-y-3">{tickets.length === 0 ? <div data-testid="ticket-empty" className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><p className="text-lg font-semibold text-slate-800">No tickets yet</p><p className="mt-2 text-slate-500">Create your first ticket to get help from your team.</p></div> : tickets.map((ticket) => <Link data-testid="ticket-row" key={ticket.id} href={`/tickets/${ticket.id}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300"><div><h2 className="font-semibold text-slate-900">{ticket.subject}</h2><p className="mt-1 text-xs text-slate-400">{new Date(ticket.created_at).toLocaleDateString()}</p></div><div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide"><span className="text-slate-500">{ticket.priority}</span><span className={ticket.status === "open" ? "rounded-full bg-emerald-50 px-3 py-1 text-emerald-700" : "rounded-full bg-slate-100 px-3 py-1 text-slate-500"}>{ticket.status.replace("_", " ")}</span>{ticket.overdue && <span data-testid="overdue-badge" className="rounded-full bg-rose-100 px-3 py-1 text-rose-700">Overdue</span>}</div></Link>)}</div>}
  </main>;
}
