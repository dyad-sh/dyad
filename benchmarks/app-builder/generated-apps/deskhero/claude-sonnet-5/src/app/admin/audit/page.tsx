"use client";

import { useEffect, useState } from "react";
import type { AuditEvent } from "@/types/ticket";

const EVENT_LABELS: Record<string, string> = {
  role_change: "Role Change",
  activation_change: "Activation Change",
  status_transition: "Status Transition",
};

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/audit")
      .then((res) => (res.ok ? res.json() : []))
      .then(setEvents);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Audit Trail</h1>

      {events === null ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-slate-500">No audit events yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table data-testid="audit-table" className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Detail</th>
                <th className="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.id}
                  data-testid="audit-row"
                  className="border-t border-slate-100"
                >
                  <td className="px-4 py-3 text-slate-900">
                    {EVENT_LABELS[event.event_type] ?? event.event_type}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {event.actor_email}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {event.target_label}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{event.detail}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {new Date(event.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
