"use client";

import { useEffect, useState } from "react";
import { TicketRow } from "@/components/ticket-row";
import type { Ticket } from "@/types/ticket";

function TicketRows({ tickets }: { tickets: Ticket[] }) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No tickets here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tickets.map((ticket) => (
        <TicketRow key={ticket.id} ticket={ticket} />
      ))}
    </div>
  );
}

export default function AgentDashboardPage() {
  const [unassigned, setUnassigned] = useState<Ticket[] | null>(null);
  const [mine, setMine] = useState<Ticket[] | null>(null);

  useEffect(() => {
    fetch("/api/tickets?queue=unassigned")
      .then((res) => (res.ok ? res.json() : []))
      .then(setUnassigned);
    fetch("/api/tickets?queue=mine")
      .then((res) => (res.ok ? res.json() : []))
      .then(setMine);
  }, []);

  return (
    <div data-testid="agent-dashboard" className="space-y-8">
      <h1 className="text-2xl font-semibold text-slate-900">
        Agent Dashboard
      </h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-800">
          Unassigned Open Tickets
        </h2>
        <div data-testid="queue-unassigned">
          {unassigned === null ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : (
            <TicketRows tickets={unassigned} />
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-800">
          Assigned to Me
        </h2>
        <div data-testid="queue-mine">
          {mine === null ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : (
            <TicketRows tickets={mine} />
          )}
        </div>
      </section>
    </div>
  );
}
