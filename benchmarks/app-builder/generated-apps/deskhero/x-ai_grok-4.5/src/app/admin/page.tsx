"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList, MessageSquareText, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type StatusCounts = {
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
};

export default function AdminDashboardPage() {
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/tickets?scope=stats");
        if (!response.ok) {
          if (response.status === 403) {
            window.location.href = "/account-deactivated";
            return;
          }
          const data = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? "Failed to load stats");
        }
        const data = (await response.json()) as StatusCounts;
        if (!cancelled) setCounts(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load stats");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards: { key: keyof StatusCounts; label: string }[] = [
    { key: "open", label: "Open" },
    { key: "in_progress", label: "In progress" },
    { key: "resolved", label: "Resolved" },
    { key: "closed", label: "Closed" },
  ];

  return (
    <div data-testid="admin-dashboard" className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Admin dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Monitor the ticket pipeline and manage the helpdesk.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/users">
              <Users className="mr-2 h-4 w-4" />
              Users
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/canned">
              <MessageSquareText className="mr-2 h-4 w-4" />
              Canned replies
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/audit">
              <ClipboardList className="mr-2 h-4 w-4" />
              Audit
            </Link>
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.key} className="border-slate-200/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {counts ? counts[card.key] : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500">
                Tickets currently {card.label.toLowerCase()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
