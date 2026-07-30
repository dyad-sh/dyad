"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PRIORITY_OPTIONS, type Priority, type Ticket } from "@/lib/tickets";
import { errorMessage } from "@/lib/error-message";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export default function NewTicketPage() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), body, priority }),
      });
      if (res.status === 401) {
        window.location.href = "/auth/sign-in";
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(errorMessage(payload, "Could not create the ticket."));
        setSubmitting(false);
        return;
      }
      const ticket = (await res.json()) as Ticket;
      router.push(`/tickets/${ticket.id}`);
    } catch (err) {
      setError(errorMessage(err, "Could not create the ticket."));
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Link
        href="/tickets"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to tickets
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
        New ticket
      </h1>

      <form
        onSubmit={onSubmit}
        noValidate
        className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="space-y-1.5">
          <label
            htmlFor="subject"
            className="text-sm font-medium text-slate-700"
          >
            Subject
          </label>
          <input
            id="subject"
            data-testid="ticket-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Short summary of the issue"
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="body" className="text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            id="body"
            data-testid="ticket-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add any details that will help resolve this."
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="priority"
            className="text-sm font-medium text-slate-700"
          >
            Priority
          </label>
          <select
            id="priority"
            data-testid="ticket-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            className={`${inputClass} appearance-none`}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p
            data-testid="ticket-error"
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            data-testid="ticket-submit"
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create ticket"}
          </button>
          <Link
            href="/tickets"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
