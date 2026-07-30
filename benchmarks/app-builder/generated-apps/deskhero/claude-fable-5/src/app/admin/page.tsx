"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OverdueBadge,
  PriorityBadge,
  StatusBadge,
} from "@/components/ticket-badges";
import { STATUSES, isOverdue, type Status, type Ticket } from "@/lib/tickets";
import { Users } from "lucide-react";

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export default function AdminDashboardPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);

  useEffect(() => {
    fetch("/api/tickets?queue=all")
      .then((res) => (res.ok ? res.json() : []))
      .then(setTickets)
      .catch(() => setTickets([]));
  }, []);

  return (
    <div data-testid="admin-dashboard">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Admin dashboard
          </h1>
          <p className="text-sm text-slate-500">Helpdesk overview</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/users">
            <Users className="mr-1.5 h-4 w-4" />
            Manage users
          </Link>
        </Button>
      </div>

      {tickets === null ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {STATUSES.map((s) => (
            <Skeleton key={s} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {STATUSES.map((status) => (
              <div
                key={status}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <p className="text-sm text-slate-500">{STATUS_LABELS[status]}</p>
                <p className="mt-1 text-3xl font-semibold text-slate-900">
                  {tickets.filter((t) => t.status === status).length}
                </p>
              </div>
            ))}
          </div>

          <h2 className="mb-3 text-lg font-medium text-slate-900">
            All tickets
          </h2>
          {tickets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white py-10 text-center text-sm text-slate-500">
              No tickets yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    href={`/tickets/${ticket.id}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-indigo-300 hover:shadow"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {ticket.subject}
                      </p>
                      <p className="text-xs text-slate-400">
                        Requested by {ticket.requester_name ?? "Unknown"} ·
                        Assignee: {ticket.assignee_name ?? "Unassigned"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isOverdue(ticket) && <OverdueBadge />}
                      <PriorityBadge priority={ticket.priority} />
                      <StatusBadge status={ticket.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
