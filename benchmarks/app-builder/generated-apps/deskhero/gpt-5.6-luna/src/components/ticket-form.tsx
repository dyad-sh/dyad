"use client";

import { FormEvent, useState } from "react";

type Ticket = { id?: string; subject: string; body: string; priority: "low" | "medium" | "high"; status?: "open" | "in_progress" | "resolved" | "closed" };

export function TicketForm({ initial, onSaved }: { initial?: Ticket; onSaved: (ticket: unknown) => void }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = String(form.get("subject") ?? "").trim();
    const body = String(form.get("body") ?? "");
    const priority = String(form.get("priority"));
    if (!subject) { setError("Subject is required."); return; }
    setSaving(true); setError("");
    const response = await fetch(initial ? `/api/tickets/${initial.id}` : "/api/tickets", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body, priority }) });

    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to save ticket"); setSaving(false); return; }
    onSaved(data);
  }
  return <form onSubmit={submit} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <label className="block text-sm font-semibold text-slate-700">Subject<input data-testid="ticket-subject" name="subject" defaultValue={initial?.subject} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label>
    <label className="block text-sm font-semibold text-slate-700">Details<textarea data-testid="ticket-body" name="body" defaultValue={initial?.body} rows={7} className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label>
    <label className="block text-sm font-semibold text-slate-700">Priority<select data-testid="ticket-priority" name="priority" defaultValue={initial?.priority ?? "medium"} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal outline-none focus:border-cyan-500"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
    {error && <p data-testid="ticket-error" className="text-sm font-medium text-rose-600">{error}</p>}
    {!error && <p data-testid="ticket-error" className="hidden" aria-hidden="true" />}
    <button data-testid="ticket-submit" disabled={saving} className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white transition hover:bg-cyan-700 disabled:opacity-50">{saving ? "Saving…" : initial ? "Save changes" : "Create ticket"}</button>
  </form>;
}
