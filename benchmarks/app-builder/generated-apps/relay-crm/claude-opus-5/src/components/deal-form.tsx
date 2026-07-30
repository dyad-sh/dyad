"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DEAL_STAGES,
  type ContactWithCompany,
  type DealStage,
  type DealWithContact,
} from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export function DealForm({
  contacts,
  deal,
}: {
  contacts: ContactWithCompany[];
  deal?: DealWithContact;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(deal?.title ?? "");
  const [amount, setAmount] = useState(
    deal ? String(deal.amount) : "",
  );
  const [stage, setStage] = useState<DealStage>(deal?.stage ?? "lead");
  const [contactId, setContactId] = useState(deal?.contact_id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const parsed = amount.trim() === "" ? 0 : Number(amount);
    if (!Number.isFinite(parsed)) {
      setError("Amount must be a number.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(deal ? `/api/deals/${deal.id}` : "/api/deals", {
        method: deal ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          amount: Math.trunc(parsed),
          stage,
          contact_id: contactId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not save this deal.");
        return;
      }
      router.push(`/deals/${deal ? deal.id : body.id}`);
      router.refresh();
    } catch {
      setError("Could not save this deal.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="max-w-xl space-y-5 rounded-xl border border-slate-200 bg-white p-6"
    >
      <div className="space-y-1.5">
        <label htmlFor="deal-title" className="text-sm font-medium text-slate-700">
          Title
        </label>
        <input
          id="deal-title"
          data-testid="deal-form-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="deal-amount" className="text-sm font-medium text-slate-700">
          Amount (USD)
        </label>
        <input
          id="deal-amount"
          data-testid="deal-form-amount"
          type="number"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="deal-stage" className="text-sm font-medium text-slate-700">
          Stage
        </label>
        <select
          id="deal-stage"
          data-testid="deal-form-stage"
          value={stage}
          onChange={(e) => setStage(e.target.value as DealStage)}
          className={`${inputClass} capitalize`}
        >
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="deal-contact" className="text-sm font-medium text-slate-700">
          Contact
        </label>
        <select
          id="deal-contact"
          data-testid="deal-form-contact"
          value={contactId ?? ""}
          onChange={(e) => setContactId(e.target.value)}
          className={inputClass}
        >
          <option value="">No contact</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p
          data-testid="deal-form-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : (
        <p data-testid="deal-form-error" className="hidden" />
      )}

      <button
        type="submit"
        data-testid="deal-form-submit"
        disabled={saving}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? "Saving…" : deal ? "Save changes" : "Create deal"}
      </button>
    </form>
  );
}
