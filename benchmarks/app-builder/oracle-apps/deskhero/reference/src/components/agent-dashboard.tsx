"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isOverdue, Ticket } from "@/lib/tickets";

type Queues = { unassigned: Ticket[]; mine: Ticket[] };

export function AgentDashboard() {
  const [queues, setQueues] = useState<Queues | null>(null);

  useEffect(() => {
    fetch("/api/tickets")
      .then(async (response) => (response.ok ? response.json() : null))
      .then(setQueues);
  }, []);

  return (
    <main data-testid="agent-dashboard" className="mx-auto max-w-5xl px-5 py-10">
      <p className="text-sm font-medium text-cyan-700">Agent workspace</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
        Your queue
      </h1>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Queue
          title="Unassigned open tickets"
          testId="queue-unassigned"
          tickets={queues?.unassigned}
        />
        <Queue title="Assigned to me" testId="queue-mine" tickets={queues?.mine} />
      </div>
    </main>
  );
}

function Queue({
  title,
  testId,
  tickets,
}: {
  title: string;
  testId: string;
  tickets?: Ticket[];
}) {
  return (
    <section
      data-testid={testId}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 className="font-semibold text-slate-950">{title}</h2>
      {!tickets ? (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      ) : tickets.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Nothing here right now.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Link
                data-testid="ticket-row"
                href={`/tickets/${ticket.id}`}
                className="block py-3"
              >
                <div className="flex justify-between gap-3">
                  <p className="font-medium text-slate-900">{ticket.subject}</p>
                  {isOverdue(ticket) && (
                    <span
                      data-testid="overdue-badge"
                      className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                    >
                      Overdue
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {ticket.priority} · {ticket.status}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
