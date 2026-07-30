"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Ticket = { id: string; subject: string; priority: string; status: string; assignee_id: string | null; overdue: boolean };

export default function AgentDashboard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [me, setMe] = useState("");
  useEffect(() => { Promise.all([fetch("/api/tickets").then((r) => r.json()), fetch("/api/me").then((r) => r.json())]).then(([all, profile]) => { setTickets(all); setMe(profile.id); }); }, []);
  const unassigned = tickets.filter((ticket) => ticket.status === "open" && !ticket.assignee_id);
  const mine = tickets.filter((ticket) => ticket.assignee_id === me);
  const list = (items: Ticket[]) => items.map((ticket) => <Link data-testid="ticket-row" key={ticket.id} href={`/tickets/${ticket.id}`} className="flex items-center justify-between border-b border-slate-100 px-5 py-4 last:border-0"><span className="font-semibold text-slate-800">{ticket.subject}</span><span className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500">{ticket.priority} · {ticket.status.replace("_", " ")}{ticket.overdue && <span data-testid="overdue-badge" className="rounded-full bg-rose-100 px-2 py-1 text-rose-700">Overdue</span>}</span></Link>);
  return <main data-testid="agent-dashboard" className="mx-auto max-w-5xl px-6 py-12"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-600">Agent workspace</p><h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">Ticket queues</h1><p className="mt-2 text-slate-500">Pick up unassigned work or continue your active tickets.</p><div className="mt-10 grid gap-6 lg:grid-cols-2"><section data-testid="queue-unassigned" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Unassigned open tickets</h2></div>{unassigned.length ? list(unassigned) : <p className="px-5 py-8 text-sm text-slate-500">Nothing waiting in the queue.</p>}</section><section data-testid="queue-mine" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Assigned to me</h2></div>{mine.length ? list(mine) : <p className="px-5 py-8 text-sm text-slate-500">No tickets assigned to you.</p>}</section></div></main>;
}
