"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type AuditEvent = {
  id: string;
  event_type: "role_change" | "activation_change" | "status_transition";
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  actor_email: string | null;
  target_user_email: string | null;
  target_ticket_subject: string | null;
};

const eventLabels: Record<AuditEvent["event_type"], string> = {
  role_change: "role_change",
  activation_change: "activation_change",
  status_transition: "status_transition",
};

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch("/api/admin/audit", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/auth/sign-in";
        return;
      }
      if (!active) return;
      setEvents(res.ok ? ((await res.json()) as AuditEvent[]) : []);
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
        Audit trail
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Role changes, activation changes and status transitions, newest first.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table data-testid="audit-table" className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Event</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Detail</th>
              <th className="px-4 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {events === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-slate-500">
                  No audit events yet.
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id} data-testid="audit-row">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {eventLabels[event.event_type]}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {event.actor_email || "unknown"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {event.target_user_email ||
                      event.target_ticket_subject ||
                      "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {event.old_value} → {event.new_value}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(event.created_at).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
