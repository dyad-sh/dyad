"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { TicketRow } from "@/components/ticket-row";
import type { Ticket } from "@/types/ticket";

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);

  useEffect(() => {
    fetch("/api/tickets")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setTickets(data));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">My Tickets</h1>
        <Button asChild data-testid="new-ticket-link">
          <Link href="/tickets/new">New Ticket</Link>
        </Button>
      </div>

      {tickets === null ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : tickets.length === 0 ? (
        <div
          data-testid="ticket-empty"
          className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500"
        >
          You don&apos;t have any tickets yet.
        </div>
      ) : (
        <div data-testid="ticket-list" className="space-y-3">
          {tickets.map((ticket) => (
            <TicketRow
              key={ticket.id}
              ticket={ticket}
              subtitle={ticket.assignee_name ?? "Unassigned"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
