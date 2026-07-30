"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { TicketList } from "@/components/ticket-list";
import { statusClasses, statusLabels, type Ticket } from "@/lib/tickets";
import { STATUSES, type Status } from "@/lib/workflow";

export default function AdminDashboardPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/tickets", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/auth/sign-in";
        return;
      }
      if (!res.ok) {
        if (active) setTickets([]);
        return;
      }
      const data = (await res.json()) as Ticket[];
      if (active) setTickets(data);
    })();
    return () => {
      active = false;
    };
  }, []);

  const counts = (tickets ?? []).reduce<Record<Status, number>>(
    (acc, ticket) => {
      acc[ticket.status] += 1;
      return acc;
    },
    { open: 0, in_progress: 0, resolved: 0, closed: 0 },
  );

  return (
    <div data-testid="admin-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Admin dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Ticket volume across the whole helpdesk.
          </p>
        </div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
        >
          <Users className="h-4 w-4" />
          Manage users
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATUSES.map((status) => (
          <div
            key={status}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <span
              className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClasses[status]}`}
            >
              {statusLabels[status]}
            </span>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
              {tickets === null ? "—" : counts[status]}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          Total tickets:{" "}
          <span className="font-semibold text-slate-900">
            {tickets === null ? "—" : tickets.length}
          </span>
        </p>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          All tickets
        </h2>
        <TicketList
          tickets={tickets ?? []}
          emptyMessage="No tickets yet."
          showAssignee
        />
      </section>
    </div>
  );
}
