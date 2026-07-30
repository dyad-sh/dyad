"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TicketPriority } from "@/types/ticket";

export type TicketFormValues = {
  subject: string;
  body: string;
  priority: TicketPriority;
};

export function TicketForm({
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialValues?: Partial<TicketFormValues>;
  submitLabel: string;
  onSubmit: (values: TicketFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [subject, setSubject] = useState(initialValues?.subject ?? "");
  const [body, setBody] = useState(initialValues?.body ?? "");
  const [priority, setPriority] = useState<TicketPriority>(
    initialValues?.priority ?? "medium",
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({ subject: subject.trim(), body, priority });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="subject">Subject</Label>
        <Input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          data-testid="ticket-subject"
          placeholder="Short summary of the issue"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="body">Description</Label>
        <Textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          data-testid="ticket-body"
          placeholder="Describe the issue in detail"
          rows={6}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="priority">Priority</Label>
        <select
          id="priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as TicketPriority)}
          data-testid="ticket-priority"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </div>

      {error && (
        <p
          data-testid="ticket-error"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600"
        >
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting} data-testid="ticket-submit">
          {isSubmitting ? "Saving..." : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
