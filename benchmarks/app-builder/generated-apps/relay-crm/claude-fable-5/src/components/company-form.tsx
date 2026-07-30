'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type CompanyFormValues = { name: string; domain: string };

export function CompanyForm({
  companyId,
  initialValues,
  onSaved,
}: {
  companyId?: string;
  initialValues?: CompanyFormValues;
  onSaved: (company: { id: string; name: string; domain: string }) => void;
}) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [domain, setDomain] = useState(initialValues?.domain ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(
        companyId ? `/api/companies/${companyId}` : '/api/companies',
        {
          method: companyId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, domain }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to save company');
      }
      onSaved(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save company');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <div className="space-y-1.5">
        <Label htmlFor="company-name">Name</Label>
        <Input
          id="company-name"
          required
          data-testid="company-form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="company-domain">Domain</Label>
        <Input
          id="company-domain"
          data-testid="company-form-domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
        />
      </div>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}
      <Button
        type="submit"
        data-testid="company-form-submit"
        disabled={saving}
        className="bg-indigo-600 hover:bg-indigo-700"
      >
        {saving ? 'Saving…' : companyId ? 'Save changes' : 'Create company'}
      </Button>
    </form>
  );
}
