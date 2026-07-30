"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Ticket = { status: "open" | "in_progress" | "resolved" | "closed" };

export default function AdminDashboard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  useEffect(() => { fetch("/api/tickets").then((response) => response.json()).then(setTickets); }, []);
  const count = (status: Ticket["status"]) => tickets.filter((ticket) => ticket.status === status).length;
  return <main data-testid="admin-dashboard" className="mx-auto max-w-5xl px-6 py-12"><div className="flex items-end justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-600">Admin overview</p><h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">Deskhero control room</h1><p className="mt-2 text-slate-500">Monitor your team's ticket workload.</p></div><Link href="/admin/users" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-cyan-700">Manage users</Link></div><div className="mt-10 grid gap-4 sm:grid-cols-4">{(["open", "in_progress", "resolved", "closed"] as const).map((status) => <div key={status} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm capitalize text-slate-500">{status.replace("_", " ")}</p><p className="mt-2 text-3xl font-bold text-slate-950">{count(status)}</p></div>)}</div></main>;
}
