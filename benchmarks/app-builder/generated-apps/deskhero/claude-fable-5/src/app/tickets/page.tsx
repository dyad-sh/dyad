"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OverdueBadge,
  PriorityBadge,
  StatusBadge,
} from "@/components/ticket-badges";
import { isOverdue, type Ticket } from "@/lib/tickets";
import { Inbox, Plus } from "lucide-react";

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);

  useEffect(() => {
    fetch("/api/tickets")
      .then((res) => (res.ok ? res.json() : []))
      .then(setTickets)
      .catch(() => setTickets([]));
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            My tickets
          </h1>
          <p className="text-sm text-slate-500">
            Track and manage your support requests
          </p>
        </div>
        <Button asChild className="bg-indigo-600 hover:bg-indigo-700">
          <Link href="/tickets/new" data-testid="new-ticket-link">
            <Plus className="mr-1.5 h-4 w-4" />
            New ticket
          </Link>
        </Button>
      </div>

      {tickets === null ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : tickets.length === 0 ? (
        <div
          data-testid="ticket-empty"
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Inbox className="h-6 w-6" />
          </span>
          <div>
            <p className="font-medium text-slate-900">No tickets yet</p>
            <p className="text-sm text-slate-500">
              Create your first ticket to get started.
            </p>
          </div>
        </div>
      ) : (
        <ul data-testid="ticket-list" className="space-y-3">
          {tickets.map((ticket) => (
            <li key={ticket.id} data-testid="ticket-row">
              <Link
                href={`/tickets/${ticket.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-indigo-300 hover:shadow"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">
                    {ticket.subject}
                  </p>
                  <p className="text-xs text-slate-400">
                    Created {format(new Date(ticket.created_at), "MMM d, yyyy")}
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
    </div>
  );
}
