"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Counts = {
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
};

const STATUS_LABELS: Record<keyof Counts, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export default function AdminDashboardPage() {
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    fetch("/api/admin/tickets/summary")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setCounts(data));
  }, []);

  return (
    <div data-testid="admin-dashboard" className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">
          Admin Dashboard
        </h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/users">Manage Users</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/canned">Canned Responses</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/audit">Audit Trail</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(Object.keys(STATUS_LABELS) as (keyof Counts)[]).map((status) => (
          <div
            key={status}
            className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm"
          >
            <p className="text-3xl font-semibold text-slate-900">
              {counts ? counts[status] : "-"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {STATUS_LABELS[status]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
