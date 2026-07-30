'use client';

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createTicketSchema, type Ticket } from "@/lib/tickets";

const formSchema = createTicketSchema;
type TicketFormInput = z.input<typeof formSchema>;
type TicketFormValues = z.output<typeof formSchema>;

type TicketFormProps = {
  ticket?: Ticket;
  onSaved: (ticket: Ticket) => void;
  onCancel?: () => void;
};

const fieldClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100";

export function TicketForm({ ticket, onSaved, onCancel }: TicketFormProps) {
  const [apiError, setApiError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TicketFormInput, unknown, TicketFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: ticket
      ? { subject: ticket.subject, body: ticket.body, priority: ticket.priority }
      : { subject: "", body: "", priority: "medium" },
  });

  async function onSubmit(values: TicketFormValues) {
    setApiError("");
    const response = await fetch(ticket ? `/api/tickets/${ticket.id}` : "/api/tickets", {
      method: ticket ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },

      body: JSON.stringify(values),
    });
    const data = await response.json();
    if (!response.ok) {
      setApiError(data.error ?? "Unable to save ticket");
      return;
    }
    onSaved(data as Ticket);
  }

  const message = errors.subject?.message || errors.body?.message || errors.priority?.message || apiError;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label htmlFor="ticket-subject" className="text-sm font-semibold text-slate-700">Subject</label>
        <input id="ticket-subject" data-testid="ticket-subject" className={`${fieldClass} h-11`} placeholder="What do you need help with?" {...register("subject")} />
      </div>
      <div className="space-y-2">
        <label htmlFor="ticket-body" className="text-sm font-semibold text-slate-700">Description</label>
        <textarea id="ticket-body" data-testid="ticket-body" rows={7} className={`${fieldClass} resize-y py-3`} placeholder="Add any useful context…" {...register("body")} />
      </div>
      <div className="space-y-2">
        <label htmlFor="ticket-priority" className="text-sm font-semibold text-slate-700">Priority</label>
        <select id="ticket-priority" data-testid="ticket-priority" className={`${fieldClass} h-11`} {...register("priority")}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      {message && <p data-testid="ticket-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
      <div className="flex items-center gap-3 pt-1">
        <button data-testid="ticket-submit" type="submit" disabled={isSubmitting} className="inline-flex h-10 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:opacity-60">
          {isSubmitting ? "Saving…" : ticket ? "Save changes" : "Create ticket"}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="h-10 rounded-xl px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>}
      </div>
    </form>
  );
}
