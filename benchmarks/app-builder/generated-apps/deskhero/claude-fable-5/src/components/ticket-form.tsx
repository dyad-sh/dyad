"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Priority } from "@/lib/tickets";

type TicketFormValues = {
  subject: string;
  body: string;
  priority: Priority;
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
  const [priority, setPriority] = useState<Priority>(
    initialValues?.priority ?? "medium",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ subject: subject.trim(), body, priority });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="subject">Subject</Label>
        <Input
          id="subject"
          data-testid="ticket-subject"
          placeholder="Brief summary of the issue"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="body">Description</Label>
        <Textarea
          id="body"
          data-testid="ticket-body"
          placeholder="Describe the issue in detail…"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="priority">Priority</Label>
        <select
          id="priority"
          data-testid="ticket-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      {error && (
        <p
          data-testid="ticket-error"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          type="submit"
          data-testid="ticket-submit"
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {saving ? "Saving…" : submitLabel}
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
