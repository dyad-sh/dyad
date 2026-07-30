"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AuditRow = {
  id: string;
  actor_email: string | null;
  event_type: string;
  target_label: string;
  detail: string;
  created_at: string;
};

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/admin/audit");
        if (!response.ok) {
          if (response.status === 403) {
            window.location.href = "/account-deactivated";
            return;
          }
          throw new Error("Failed to load audit trail");
        }
        const data = (await response.json()) as AuditRow[];
        if (!cancelled) setEvents(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load audit");
          setEvents([]);
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
      <div>
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Audit trail
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Role changes, activations, and ticket status transitions.
        </p>
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Events</CardTitle>
          <CardDescription>Newest events appear first.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {events === null ? (
            <p className="text-sm text-slate-500">Loading audit events...</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-slate-500">No audit events yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table data-testid="audit-table" className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Actor</th>
                    <th className="px-4 py-3 font-medium">Target</th>
                    <th className="px-4 py-3 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {events.map((event) => (
                    <tr key={event.id} data-testid="audit-row">
                      <td className="px-4 py-3 text-slate-600">
                        {new Date(event.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {event.event_type}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {event.actor_email ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {event.target_label}
                      </td>
                      <td className="px-4 py-3 text-slate-800">{event.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
