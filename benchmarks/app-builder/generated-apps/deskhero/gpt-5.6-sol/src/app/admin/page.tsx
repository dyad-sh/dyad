'use client';

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, CircleDot, Clock3, LockKeyhole, MessageSquareText, ScrollText, Users } from "lucide-react";

import { statuses, type Ticket } from "@/lib/tickets";

const icons = { open: CircleDot, in_progress: Clock3, resolved: CheckCircle2, closed: LockKeyhole };

export default function AdminDashboard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/tickets").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to load dashboard");
      setTickets(data);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  const counts = useMemo(() => Object.fromEntries(statuses.map((status) => [status, tickets.filter((ticket) => ticket.status === status).length])), [tickets]);

  return (
    <div data-testid="admin-dashboard">
      <div className="mb-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Administration</p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Helpdesk overview</h1>
        <p className="mt-2 text-sm text-slate-500">Monitor the workflow and manage your support team.</p>
      </div>
      {error && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statuses.map((status) => {
          const Icon = icons[status];
          return <div key={status} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-medium capitalize text-slate-500">{status.replace("_", " ")}</span><Icon className="size-5 text-indigo-500" /></div><p className="mt-4 text-3xl font-bold text-slate-950">{counts[status] ?? 0}</p></div>;
        })}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href="/admin/users" className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200"><span className="flex size-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Users className="size-5" /></span><span className="flex-1"><strong className="block text-slate-900">Manage users</strong><span className="text-sm text-slate-500">Roles and account access</span></span><ArrowRight className="size-4 text-slate-300 group-hover:text-indigo-600" /></Link>
        <Link href="/tickets" className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200"><span className="flex size-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><CircleDot className="size-5" /></span><span className="flex-1"><strong className="block text-slate-900">View all tickets</strong><span className="text-sm text-slate-500">Assign and progress support work</span></span><ArrowRight className="size-4 text-slate-300 group-hover:text-indigo-600" /></Link>
        <Link href="/admin/canned" className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200"><span className="flex size-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><MessageSquareText className="size-5" /></span><span className="flex-1"><strong className="block text-slate-900">Canned responses</strong><span className="text-sm text-slate-500">Manage reusable replies</span></span><ArrowRight className="size-4 text-slate-300 group-hover:text-indigo-600" /></Link>
        <Link href="/admin/audit" className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200"><span className="flex size-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><ScrollText className="size-5" /></span><span className="flex-1"><strong className="block text-slate-900">Audit trail</strong><span className="text-sm text-slate-500">Review security and workflow events</span></span><ArrowRight className="size-4 text-slate-300 group-hover:text-indigo-600" /></Link>
      </div>

    </div>
  );
}
