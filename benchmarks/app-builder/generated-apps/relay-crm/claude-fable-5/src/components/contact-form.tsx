'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Company = { id: string; name: string };

export type ContactFormValues = {
  name: string;
  email: string;
  phone: string;
  title: string;
  company_id: string | null;
};

export function ContactForm({
  contactId,
  initialValues,
}: {
  contactId?: string;
  initialValues?: ContactFormValues;
}) {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [name, setName] = useState(initialValues?.name ?? '');
  const [email, setEmail] = useState(initialValues?.email ?? '');
  const [phone, setPhone] = useState(initialValues?.phone ?? '');
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [companyId, setCompanyId] = useState(initialValues?.company_id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/companies')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Company[]) => setCompanies(data))
      .catch(() => setCompanies([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(
        contactId ? `/api/contacts/${contactId}` : '/api/contacts',
        {
          method: contactId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            phone,
            title,
            company_id: companyId || null,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to save contact');
      }
      const contact = await res.json();
      router.push(`/contacts/${contact.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save contact');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <div className="space-y-1.5">
        <Label htmlFor="contact-name">Name</Label>
        <Input
          id="contact-name"
          required
          data-testid="contact-form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-email">Email</Label>
        <Input
          id="contact-email"
          type="email"
          data-testid="contact-form-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-phone">Phone</Label>
        <Input
          id="contact-phone"
          data-testid="contact-form-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-title">Title</Label>
        <Input
          id="contact-title"
          data-testid="contact-form-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-company">Company</Label>
        <select
          id="contact-company"
          data-testid="contact-form-company"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">No company</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p
          data-testid="contact-form-error"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
        >
          {error}
        </p>
      )}
      <Button
        type="submit"
        data-testid="contact-form-submit"
        disabled={saving}
        className="bg-indigo-600 hover:bg-indigo-700"
      >
        {saving ? 'Saving…' : contactId ? 'Save changes' : 'Create contact'}
      </Button>
    </form>
  );
}
