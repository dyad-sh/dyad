"use client";

import { useEffect, useState } from "react";
import { TicketList } from "@/components/ticket-list";
import type { Ticket } from "@/lib/tickets";

export default function AgentDashboardPage() {
  const [unassigned, setUnassigned] = useState<Ticket[]>([]);
  const [mine, setMine] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const [openRes, mineRes] = await Promise.all([
        fetch("/api/tickets?unassigned=1&status=open", { cache: "no-store" }),
        fetch("/api/tickets?assignee=me", { cache: "no-store" }),
      ]);
      if (openRes.status === 401 || mineRes.status === 401) {
        window.location.href = "/auth/sign-in";
        return;
      }
      const openList = openRes.ok ? ((await openRes.json()) as Ticket[]) : [];
      const mineList = mineRes.ok ? ((await mineRes.json()) as Ticket[]) : [];
      if (!active) return;
      setUnassigned(openList);
      setMine(mineList);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div data-testid="agent-dashboard">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Agent queues
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Pick up unassigned work and track what&apos;s yours.
      </p>

      {loading ? (
        <div className="mt-6 space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white"
            />
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Unassigned open tickets
            </h2>
            <TicketList
              tickets={unassigned}
              testId="queue-unassigned"
              emptyMessage="No unassigned open tickets."
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Assigned to me
            </h2>
            <TicketList
              tickets={mine}
              testId="queue-mine"
              emptyMessage="Nothing assigned to you yet."
            />
          </section>
        </div>
      )}
    </div>
  );
}
