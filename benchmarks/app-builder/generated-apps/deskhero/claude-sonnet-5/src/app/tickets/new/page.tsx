"use client";

import { useRouter } from "next/navigation";
import { TicketForm, type TicketFormValues } from "@/components/ticket-form";

export default function NewTicketPage() {
  const router = useRouter();

  async function handleSubmit(values: TicketFormValues) {
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? "Failed to create ticket.");
    }

    const ticket = await res.json();
    router.push(`/tickets/${ticket.id}`);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">New Ticket</h1>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <TicketForm submitLabel="Create Ticket" onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
