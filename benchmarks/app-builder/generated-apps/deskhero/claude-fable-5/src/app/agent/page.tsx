"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OverdueBadge,
  PriorityBadge,
  StatusBadge,
} from "@/components/ticket-badges";
import { isOverdue, type Ticket } from "@/lib/tickets";

function QueueList({
  tickets,
  emptyText,
}: {
  tickets: Ticket[];
  emptyText: string;
}) {
  if (tickets.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white py-8 text-center text-sm text-slate-500">
        {emptyText}
      </p>
    );
  }
  return (
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
                Requested by {ticket.requester_name ?? "Unknown"}
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
  );
}

export default function AgentDashboardPage() {
  const [unassigned, setUnassigned] = useState<Ticket[] | null>(null);
  const [mine, setMine] = useState<Ticket[] | null>(null);

  useEffect(() => {
    fetch("/api/tickets?queue=unassigned")
      .then((res) => (res.ok ? res.json() : []))
      .then(setUnassigned)
      .catch(() => setUnassigned([]));
    fetch("/api/tickets?queue=mine")
      .then((res) => (res.ok ? res.json() : []))
      .then(setMine)
      .catch(() => setMine([]));
  }, []);

  return (
    <div data-testid="agent-dashboard" className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Agent queue
        </h1>
        <p className="text-sm text-slate-500">
          Pick up unassigned tickets and work your assignments
        </p>
      </div>

      <section data-testid="queue-unassigned">
        <h2 className="mb-3 text-lg font-medium text-slate-900">
          Unassigned open tickets
        </h2>
        {unassigned === null ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : (
          <QueueList
            tickets={unassigned}
            emptyText="No unassigned open tickets."
          />
        )}
      </section>

      <section data-testid="queue-mine">
        <h2 className="mb-3 text-lg font-medium text-slate-900">
          Assigned to me
        </h2>
        {mine === null ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : (
          <QueueList tickets={mine} emptyText="Nothing assigned to you yet." />
        )}
      </section>
    </div>
  );
}
