"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEAL_STAGES } from "@/lib/deals";
import type { Contact, DealStage } from "@/lib/types";

export type DealFormValues = {
  title: string;
  amount: string;
  stage: DealStage;
  contactId: string;
};

const STAGE_LABELS: Record<DealStage, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export function DealForm({
  contacts,
  defaultValues,
  onSubmit,
  submitLabel,
}: {
  contacts: Contact[];
  defaultValues?: Partial<DealFormValues>;
  onSubmit: (values: DealFormValues) => Promise<string | void>;
  submitLabel: string;
}) {
  const [title, setTitle] = useState(defaultValues?.title ?? "");
  const [amount, setAmount] = useState(defaultValues?.amount ?? "");
  const [stage, setStage] = useState<DealStage>(defaultValues?.stage ?? "lead");
  const [contactId, setContactId] = useState(defaultValues?.contactId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onSubmit({ title, amount, stage, contactId });
      if (result) {
        setError(result);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="deal-form-title">Title</Label>
        <Input
          id="deal-form-title"
          data-testid="deal-form-title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="deal-form-amount">Amount (USD)</Label>
        <Input
          id="deal-form-amount"
          data-testid="deal-form-amount"
          type="number"
          min={0}
          step={1}
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="deal-form-stage">Stage</Label>
        <select
          id="deal-form-stage"
          data-testid="deal-form-stage"
          value={stage}
          onChange={(e) => setStage(e.target.value as DealStage)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="deal-form-contact">Contact</Label>
        <select
          id="deal-form-contact"
          data-testid="deal-form-contact"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">No contact</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p data-testid="deal-form-error" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" data-testid="deal-form-submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
