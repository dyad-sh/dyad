"use client";

import { FormEvent, useState } from "react";

import type { TicketPriority } from "@/lib/tickets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type TicketFormProps = {
  initialSubject?: string;
  initialBody?: string;
  initialPriority?: TicketPriority;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (values: {
    subject: string;
    body: string;
    priority: TicketPriority;
  }) => Promise<void>;
};

export function TicketForm({
  initialSubject = "",
  initialBody = "",
  initialPriority = "medium",
  submitLabel,
  pendingLabel,
  onSubmit,
}: TicketFormProps) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [priority, setPriority] = useState<TicketPriority>(initialPriority);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedSubject = subject.trim();
    if (!trimmedSubject) {
      setError("Subject is required.");
      return;
    }

    setPending(true);
    try {
      await onSubmit({
        subject: trimmedSubject,
        body,
        priority,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to save ticket.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="space-y-2">
        <Label htmlFor="ticket-subject">Subject</Label>
        <Input
          id="ticket-subject"
          data-testid="ticket-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Brief summary of the issue"
          disabled={pending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ticket-body">Body</Label>
        <Textarea
          id="ticket-body"
          data-testid="ticket-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Describe the problem in more detail"
          rows={6}
          disabled={pending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ticket-priority">Priority</Label>
        <select
          id="ticket-priority"
          data-testid="ticket-priority"
          value={priority}
          onChange={(event) =>
            setPriority(event.target.value as TicketPriority)
          }
          disabled={pending}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <p
        data-testid="ticket-error"
        className={
          error
            ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            : "sr-only"
        }
        role="alert"
      >
        {error ?? ""}
      </p>
      <Button type="submit" data-testid="ticket-submit" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
