'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ClockAlert, Inbox, Plus } from "lucide-react";

import { isOverdue, type Ticket } from "@/lib/tickets";

const priorityStyles = {

  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-red-50 text-red-700",
};

const statusStyles = {
  open: "bg-emerald-50 text-emerald-700",
  in_progress: "bg-blue-50 text-blue-700",
  resolved: "bg-violet-50 text-violet-700",
  closed: "bg-slate-100 text-slate-600",
};

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);

  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/tickets")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load tickets");
        setTickets(data);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Your workspace</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Tickets</h1>
          <p className="mt-2 text-sm text-slate-500">Track every request from open to resolved.</p>
        </div>
        <Link data-testid="new-ticket-link" href="/tickets/new" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">
          <Plus className="size-4" /> <span className="hidden sm:inline">New ticket</span>
        </Link>
      </div>

      {error && <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {tickets === null && !error && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading tickets…</div>}
      {tickets?.length === 0 && (
        <div data-testid="ticket-empty" className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><Inbox className="size-6" /></span>
          <h2 className="mt-4 font-semibold text-slate-900">No tickets yet</h2>
          <p className="mt-1 text-sm text-slate-500">Create your first request and it will appear here.</p>
        </div>
      )}
      {tickets && tickets.length > 0 && (
        <div data-testid="ticket-list" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {tickets.map((ticket) => (
            <Link key={ticket.id} data-testid="ticket-row" href={`/tickets/${ticket.id}`} className="group flex items-center gap-4 border-b border-slate-100 px-5 py-4 transition last:border-b-0 hover:bg-slate-50 sm:px-6">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${priorityStyles[ticket.priority]}`}>{ticket.priority}</span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold text-slate-900">{ticket.subject}</h2>
                <p className="mt-1 truncate text-xs text-slate-400">{new Date(ticket.created_at).toLocaleString()} · {ticket.assignee_name ? `Assigned to ${ticket.assignee_name}` : "Unassigned"}</p>
              </div>
              {isOverdue(ticket) && <span data-testid="overdue-badge" className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700"><ClockAlert className="size-3" /> Overdue</span>}
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusStyles[ticket.status]}`}>{ticket.status.replace("_", " ")}</span>
              <ArrowRight className="size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" />

            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
