"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Ticket } from "@/lib/tickets";

export function AdminDashboard() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  useEffect(() => { fetch("/api/tickets").then(async response => response.ok ? response.json() : []).then(setTickets); }, []);
  const counts = ["open", "in_progress", "resolved", "closed"].map(status => [status, tickets?.filter(ticket => ticket.status === status).length ?? 0] as const);
  return <main data-testid="admin-dashboard" className="mx-auto max-w-5xl px-5 py-10"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-cyan-700">Administration</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Helpdesk overview</h1><p className="mt-2 text-slate-500">A current snapshot of ticket workflow.</p></div><Link href="/admin/users" className="rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700">Manage users</Link></div><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{counts.map(([status, count]) => <div key={status} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm capitalize text-slate-500">{status.replace("_", " ")}</p><p className="mt-2 text-3xl font-bold text-slate-950">{count}</p></div>)}</div></main>;
}
