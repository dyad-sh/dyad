"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TicketForm } from "@/components/ticket-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function NewTicketPage() {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/tickets"
          className="mb-4 inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to tickets
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          New ticket
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Capture the issue details so you can track it later.
        </p>
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Ticket details</CardTitle>
          <CardDescription>
            Subject is required. Priority defaults to medium.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TicketForm
            submitLabel="Create ticket"
            pendingLabel="Creating..."
            onSubmit={async (values) => {
              const response = await fetch("/api/tickets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values),
              });

              const data = (await response.json().catch(() => null)) as {
                id?: string;
                error?: string;
              } | null;

              if (!response.ok) {
                throw new Error(data?.error ?? "Failed to create ticket");
              }

              if (!data?.id) {
                throw new Error("Failed to create ticket");
              }

              router.push(`/tickets/${data.id}`);
              router.refresh();
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
