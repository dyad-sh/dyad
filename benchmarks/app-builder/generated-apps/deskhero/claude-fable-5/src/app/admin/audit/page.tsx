"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AuditEvent = {
  id: string;
  event_type: "role_change" | "activation_change" | "status_transition";
  detail: string;
  created_at: string;
  actor_email: string | null;
  target: string | null;
};

const EVENT_LABELS: Record<AuditEvent["event_type"], string> = {
  role_change: "Role change",
  activation_change: "Activation change",
  status_transition: "Status transition",
};

const EVENT_STYLES: Record<AuditEvent["event_type"], string> = {
  role_change: "bg-indigo-100 text-indigo-700 hover:bg-indigo-100",
  activation_change: "bg-red-100 text-red-700 hover:bg-red-100",
  status_transition: "bg-blue-100 text-blue-700 hover:bg-blue-100",
};

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/audit")
      .then((res) => (res.ok ? res.json() : []))
      .then(setEvents)
      .catch(() => setEvents([]));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Audit trail
        </h1>
        <p className="text-sm text-slate-500">
          Role changes, activation changes, and status transitions
        </p>
      </div>

      {events === null ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white py-10 text-center text-sm text-slate-500">
          No audit events yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <Table data-testid="audit-table">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id} data-testid="audit-row">
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={EVENT_STYLES[event.event_type]}
                    >
                      {EVENT_LABELS[event.event_type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {event.actor_email ?? "Unknown"}
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-slate-900">
                    {event.target ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {event.detail}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-400">
                    {format(new Date(event.created_at), "MMM d, yyyy h:mm a")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
