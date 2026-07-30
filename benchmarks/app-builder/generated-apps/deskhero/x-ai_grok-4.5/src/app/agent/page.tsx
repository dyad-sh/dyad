"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { OverdueBadge } from "@/components/overdue-badge";
import { PriorityBadge, StatusBadge } from "@/components/priority-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Ticket } from "@/lib/tickets";

function TicketQueueList({
  testId,
  tickets,
  emptyLabel,
}: {
  testId: string;
  tickets: Ticket[];
  emptyLabel: string;
}) {
  if (tickets.length === 0) {
    return (
      <div
        data-testid={testId}
        className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-10 text-center text-sm text-slate-600"
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <ul data-testid={testId} className="divide-y rounded-xl border">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Link
            href={`/tickets/${ticket.id}`}
            data-testid="ticket-row"
            className="flex flex-col gap-3 px-4 py-4 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">
                {ticket.subject}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {ticket.creator_email ?? "Unknown requester"} ·{" "}
                {new Date(ticket.created_at).toLocaleString()} · Due{" "}
                {new Date(ticket.sla_due_at).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ticket.overdue ? <OverdueBadge /> : null}
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [unassignedRes, mineRes] = await Promise.all([
          fetch("/api/tickets?scope=unassigned"),
          fetch("/api/tickets?scope=mine"),
        ]);

        if (!unassignedRes.ok || !mineRes.ok) {
          if (unassignedRes.status === 403 || mineRes.status === 403) {
            window.location.href = "/account-deactivated";
            return;
          }
          throw new Error("Failed to load agent queues");
        }

        const unassignedData = (await unassignedRes.json()) as Ticket[];
        const mineData = (await mineRes.json()) as Ticket[];
        if (!cancelled) {
          setUnassigned(unassignedData);
          setMine(mineData);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load queues");
          setUnassigned([]);
          setMine([]);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div data-testid="agent-dashboard" className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Agent queue
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Claim open work and keep your assigned tickets moving.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Unassigned open tickets</CardTitle>
          <CardDescription>
            Self-assign from the detail page to start work.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unassigned === null ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : (
            <TicketQueueList
              testId="queue-unassigned"
              tickets={unassigned}
              emptyLabel="No unassigned open tickets."
            />
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Assigned to me</CardTitle>
          <CardDescription>Everything currently on your plate.</CardDescription>
        </CardHeader>
        <CardContent>
          {mine === null ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : (
            <TicketQueueList
              testId="queue-mine"
              tickets={mine}
              emptyLabel="You have no assigned tickets."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
