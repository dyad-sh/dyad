"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { OverdueBadge } from "@/components/overdue-badge";
import { PriorityBadge, StatusBadge } from "@/components/priority-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Role } from "@/lib/roles";
import type { Ticket } from "@/lib/tickets";

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const meRes = await fetch("/api/me");
        if (!meRes.ok) {
          if (meRes.status === 403) {
            window.location.href = "/account-deactivated";
            return;
          }
          throw new Error("Failed to load session");
        }
        const me = (await meRes.json()) as { id: string; role: Role };
        if (cancelled) return;
        setRole(me.role);

        const ticketsRes = await fetch("/api/tickets");
        if (!ticketsRes.ok) {
          const data = (await ticketsRes.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? "Failed to load tickets");
        }
        const data = (await ticketsRes.json()) as Ticket[];
        if (cancelled) return;

        const list =
          me.role === "requester"
            ? data
            : data.filter((ticket) => ticket.creator_id === me.id);
        setTickets(list);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load tickets",
          );
          setTickets([]);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            My tickets
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Track the support requests you submitted.
          </p>
        </div>
        <Button asChild>
          <Link href="/tickets/new" data-testid="new-ticket-link">
            <Plus className="mr-2 h-4 w-4" />
            New ticket
          </Link>
        </Button>
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Your requests</CardTitle>
          <CardDescription>
            Newest tickets appear first.
            {role === "requester"
              ? " Status updates follow the helpdesk workflow."
              : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {tickets === null ? (
            <p className="text-sm text-slate-500">Loading tickets...</p>
          ) : tickets.length === 0 ? (
            <div
              data-testid="ticket-empty"
              className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-12 text-center"
            >
              <p className="text-base font-medium text-slate-900">
                No tickets yet
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Create your first ticket to get started.
              </p>
            </div>
          ) : (
            <ul data-testid="ticket-list" className="divide-y rounded-xl border">
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
                        {new Date(ticket.created_at).toLocaleString()}
                        {ticket.assignee_email
                          ? ` · Assignee: ${ticket.assignee_email}`
                          : " · Unassigned"}
                        {` · Due ${new Date(ticket.sla_due_at).toLocaleString()}`}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
