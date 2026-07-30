"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { TicketForm } from "@/components/ticket-form";
import { ArrowLeft } from "lucide-react";

export default function NewTicketPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/tickets"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to tickets
      </Link>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold tracking-tight text-slate-900">
          New ticket
        </h1>
        <TicketForm
          submitLabel="Create ticket"
          onSubmit={async (values) => {
            const res = await fetch("/api/tickets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(values),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => null);
              throw new Error(data?.error ?? "Could not create ticket.");
            }
            const ticket = await res.json();
            router.push(`/tickets/${ticket.id}`);
          }}
          onCancel={() => router.push("/tickets")}
        />
      </div>
    </div>
  );
}
