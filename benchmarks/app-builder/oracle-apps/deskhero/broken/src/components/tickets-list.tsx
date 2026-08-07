"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CirclePlus } from "lucide-react";
import { isOverdue, Ticket } from "@/lib/tickets";

export function TicketsList() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);

  useEffect(() => { fetch("/api/tickets").then(async (response) => response.ok ? response.json() : []).then(setTickets); }, []);

  return <main className="mx-auto max-w-5xl px-5 py-10"><div className="mb-9 flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-cyan-700">Your workspace</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Tickets</h1><p className="mt-2 text-slate-500">Track requests that need your attention.</p></div><Link data-testid="new-ticket-link" href="/tickets/new" className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-700"><CirclePlus className="size-4" />New ticket</Link></div>{tickets === null ? <p className="text-sm text-slate-500">Loading tickets…</p> : tickets.length === 0 ? <div data-testid="ticket-empty" className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><h2 className="font-semibold text-slate-950">No tickets yet</h2><p className="mt-2 text-sm text-slate-500">Create your first request to get started.</p></div> : <div data-testid="ticket-list" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">{tickets.map(ticket => <Link data-testid="ticket-row" href={`/tickets/${ticket.id}`} key={ticket.id} className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0 transition hover:bg-slate-50"><div className="min-w-0"><p className="truncate font-semibold text-slate-950">{ticket.subject}</p><p className="mt-1 text-xs text-slate-500">{new Date(ticket.created_at).toLocaleDateString()}</p></div><div className="flex shrink-0 gap-2">{isOverdue(ticket) && <Badge testId="overdue-badge" value="Overdue" />}<Badge value={ticket.priority} /><Badge value={ticket.status} /></div></Link>)}</div>}</main>;
}

function Badge({ value, testId }: { value: string; testId?: string }) { return <span data-testid={testId} className={`rounded-full px-2.5 py-1 text-xs font-medium ${value === "Overdue" || value === "high" ? "bg-red-50 text-red-700" : value === "medium" ? "bg-amber-50 text-amber-700" : value === "open" ? "bg-cyan-50 text-cyan-700" : "bg-slate-100 text-slate-600"}`}>{value}</span>; }
