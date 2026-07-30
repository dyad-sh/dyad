'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClockAlert, Inbox, UserCheck } from "lucide-react";

import type { CurrentUser } from "@/lib/auth/current-user";
import { isOverdue, type Ticket } from "@/lib/tickets";

function Queue({ tickets, empty }: { tickets: Ticket[]; empty: string }) {
  if (!tickets.length) return <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">{empty}</p>;
  return <div className="divide-y divide-slate-100">{tickets.map((ticket) => <Link key={ticket.id} href={`/tickets/${ticket.id}`} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0"><span className={`size-2 rounded-full ${ticket.priority === "high" ? "bg-red-500" : ticket.priority === "medium" ? "bg-amber-500" : "bg-slate-300"}`} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-slate-900">{ticket.subject}</strong><span className="text-xs text-slate-400">{ticket.creator_name} · {ticket.status.replace("_", " ")}</span></span>{isOverdue(ticket) && <span data-testid="overdue-badge" className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700"><ClockAlert className="size-3" /> Overdue</span>}</Link>)}</div>;
}

export default function AgentDashboard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/tickets"), fetch("/api/me")]).then(async ([ticketsResponse, meResponse]) => {
      const ticketsData = await ticketsResponse.json();
      const meData = await meResponse.json();
      if (!ticketsResponse.ok) throw new Error(ticketsData.error ?? "Unable to load queue");
      setTickets(ticketsData); setMe(meData);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  const unassigned = tickets.filter((ticket) => !ticket.assignee_id && ticket.status === "open");
  const mine = tickets.filter((ticket) => ticket.assignee_id === me?.id);

  return (
    <div data-testid="agent-dashboard">
      <div className="mb-8"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Support workspace</p><h1 className="text-3xl font-bold tracking-tight text-slate-950">Agent queue</h1><p className="mt-2 text-sm text-slate-500">Pick up new requests and progress your assigned work.</p></div>
      {error && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section data-testid="queue-unassigned" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-5 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Inbox className="size-5" /></span><div><h2 className="font-semibold text-slate-900">Unassigned open</h2><p className="text-xs text-slate-400">{unassigned.length} waiting</p></div></div><Queue tickets={unassigned} empty="No tickets are waiting." /></section>
        <section data-testid="queue-mine" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-5 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><UserCheck className="size-5" /></span><div><h2 className="font-semibold text-slate-900">Assigned to me</h2><p className="text-xs text-slate-400">{mine.length} tickets</p></div></div><Queue tickets={mine} empty="Nothing is assigned to you." /></section>
      </div>
    </div>
  );
}
