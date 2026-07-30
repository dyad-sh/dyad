"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Ticket } from "@/lib/tickets";

type TicketFormProps = { ticket?: Ticket; onSaved?: (ticket: Ticket) => void };

export function TicketForm({ ticket, onSaved }: TicketFormProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = String(form.get("subject") || "").trim();
    if (!subject) return setError("Subject is required.");

    setError("");
    setSaving(true);
    const response = await fetch(ticket ? `/api/tickets/${ticket.id}` : "/api/tickets", {
      method: ticket ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body: String(form.get("body") || ""), priority: form.get("priority") }),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(result.error || "Unable to save the ticket.");

    if (onSaved) onSaved(result);
    else router.push(`/tickets/${result.id}`);
  }

  return <form onSubmit={submit} className="space-y-6" noValidate>
    <label className="block text-sm font-medium text-slate-700">Subject<input data-testid="ticket-subject" name="subject" defaultValue={ticket?.subject} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-cyan-600 focus:ring-4 focus:ring-cyan-600/10" placeholder="What needs attention?" /></label>
    <label className="block text-sm font-medium text-slate-700">Details<textarea data-testid="ticket-body" name="body" defaultValue={ticket?.body} rows={6} className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-cyan-600 focus:ring-4 focus:ring-cyan-600/10" placeholder="Add useful context for the request." /></label>
    <label className="block max-w-xs text-sm font-medium text-slate-700">Priority<select data-testid="ticket-priority" name="priority" defaultValue={ticket?.priority ?? "medium"} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-cyan-600 focus:ring-4 focus:ring-cyan-600/10"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
    <p data-testid="ticket-error" className={`min-h-5 text-sm text-red-600 ${error ? "" : "invisible"}`} role="alert">{error || "No error"}</p>
    <button data-testid="ticket-submit" disabled={saving} className="rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:opacity-60">{saving ? "Saving…" : ticket ? "Save changes" : "Create ticket"}</button>
  </form>;
}
