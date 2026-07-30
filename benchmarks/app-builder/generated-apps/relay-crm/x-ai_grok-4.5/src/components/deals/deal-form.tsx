"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEAL_STAGES, type Contact, type Deal, type DealStage } from "@/lib/types";

type DealFormProps = {
  contacts: Contact[];
  deal?: Deal;
  mode: "create" | "edit";
};

export function DealForm({ contacts, deal, mode }: DealFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(deal?.title ?? "");
  const [amount, setAmount] = useState(
    deal?.amount !== undefined ? String(deal.amount) : "",
  );
  const [stage, setStage] = useState<DealStage>(deal?.stage ?? "lead");
  const [contactId, setContactId] = useState(deal?.contact_id ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    const payload = {
      title: title.trim(),
      amount: Number(amount),
      stage,
      contact_id: contactId ? contactId : null,
    };

    try {
      const response = await fetch(
        mode === "create" ? "/api/deals" : `/api/deals/${deal!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to save deal");
        return;
      }
      router.push(`/deals/${data.id}`);
      router.refresh();
    } catch {
      setError("Failed to save deal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="deal-form-title">Title</Label>
        <Input
          id="deal-form-title"
          data-testid="deal-form-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Enterprise renewal"
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
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          placeholder="10000"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="deal-form-stage">Stage</Label>
        <select
          id="deal-form-stage"
          data-testid="deal-form-stage"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={stage}
          onChange={(e) => setStage(e.target.value as DealStage)}
        >
          {DEAL_STAGES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="deal-form-contact">Contact</Label>
        <select
          id="deal-form-contact"
          data-testid="deal-form-contact"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
        >
          <option value="">No contact</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>
      </div>
      <p
        data-testid="deal-form-error"
        className={
          error ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" : "sr-only"
        }
        role="alert"
      >
        {error}
      </p>
      <div className="flex gap-3">
        <Button type="submit" data-testid="deal-form-submit" disabled={loading}>
          {loading ? "Saving…" : mode === "create" ? "Create deal" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
