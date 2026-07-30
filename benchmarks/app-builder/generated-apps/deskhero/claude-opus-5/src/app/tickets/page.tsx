"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { OverdueBadge } from "@/components/overdue-badge";
import {
  priorityClasses,
  statusClasses,
  statusLabels,
  type Ticket,
} from "@/lib/tickets";
import { isOverdue } from "@/lib/sla";

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/tickets", { cache: "no-store" });
        if (res.status === 401) {
          window.location.href = "/auth/sign-in";
          return;
        }
        if (!res.ok) throw new Error("Could not load tickets.");
        const data = (await res.json()) as Ticket[];
        if (active) setTickets(data);
      } catch {
        if (active) {
          setError("Could not load tickets.");
          setTickets([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            My tickets
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Everything you&apos;ve reported, newest first.
          </p>
        </div>
        <Link
          href="/tickets/new"
          data-testid="new-ticket-link"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New ticket
        </Link>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {tickets === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white"
            />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <div
          data-testid="ticket-empty"
          className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"
        >
          <p className="text-sm font-medium text-slate-900">No tickets yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Create your first ticket to get started.
          </p>
          <Link
            href="/tickets/new"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" />
            New ticket
          </Link>
        </div>
      ) : (
        <ul
          data-testid="ticket-list"
          className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          {tickets.map((ticket) => (
            <li key={ticket.id} data-testid="ticket-row">
              <Link
                href={`/tickets/${ticket.id}`}
                className="flex items-center justify-between gap-4 px-4 py-4 transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {ticket.subject}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {new Date(ticket.created_at).toLocaleString()}
                    {" · "}
                    {ticket.assignee_id
                      ? `Assigned to ${ticket.assignee_name || ticket.assignee_email}`
                      : "Unassigned"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${priorityClasses[ticket.priority]}`}
                  >
                    {ticket.priority}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClasses[ticket.status]}`}
                  >
                    {statusLabels[ticket.status]}
                  </span>
                  {isOverdue(ticket) && <OverdueBadge />}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
