'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DEAL_STAGES } from '@/lib/deals';

type Contact = { id: string; name: string };

export type DealFormValues = {
  title: string;
  amount: number;
  stage: string;
  contact_id: string | null;
};

export function DealForm({
  dealId,
  initialValues,
}: {
  dealId?: string;
  initialValues?: DealFormValues;
}) {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [amount, setAmount] = useState(
    initialValues ? String(initialValues.amount) : '',
  );
  const [stage, setStage] = useState(initialValues?.stage ?? 'lead');
  const [contactId, setContactId] = useState(initialValues?.contact_id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/contacts')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Contact[]) => setContacts(data))
      .catch(() => setContacts([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(dealId ? `/api/deals/${dealId}` : '/api/deals', {
        method: dealId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          amount: Number(amount),
          stage,
          contact_id: contactId || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to save deal');
      }
      const deal = await res.json();
      router.push(`/deals/${deal.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save deal');
      setSaving(false);
    }
  };

  const selectClass =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <div className="space-y-1.5">
        <Label htmlFor="deal-title">Title</Label>
        <Input
          id="deal-title"
          required
          data-testid="deal-form-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="deal-amount">Amount (USD)</Label>
        <Input
          id="deal-amount"
          type="number"
          required
          min={0}
          step={1}
          data-testid="deal-form-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="deal-stage">Stage</Label>
        <select
          id="deal-stage"
          data-testid="deal-form-stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className={selectClass}
        >
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="deal-contact">Contact</Label>
        <select
          id="deal-contact"
          data-testid="deal-form-contact"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          className={selectClass}
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
        <p
          data-testid="deal-form-error"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
        >
          {error}
        </p>
      )}
      <Button
        type="submit"
        data-testid="deal-form-submit"
        disabled={saving}
        className="bg-indigo-600 hover:bg-indigo-700"
      >
        {saving ? 'Saving…' : dealId ? 'Save changes' : 'Create deal'}
      </Button>
    </form>
  );
}
