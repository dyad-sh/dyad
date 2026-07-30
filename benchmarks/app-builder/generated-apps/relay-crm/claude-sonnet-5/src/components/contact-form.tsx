"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Company } from "@/lib/types";

export type ContactFormValues = {
  name: string;
  email: string;
  phone: string;
  title: string;
  companyId: string;
};

export function ContactForm({
  companies,
  defaultValues,
  onSubmit,
  submitLabel,
}: {
  companies: Company[];
  defaultValues?: Partial<ContactFormValues>;
  onSubmit: (values: ContactFormValues) => Promise<string | void>;
  submitLabel: string;
}) {
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [email, setEmail] = useState(defaultValues?.email ?? "");
  const [phone, setPhone] = useState(defaultValues?.phone ?? "");
  const [title, setTitle] = useState(defaultValues?.title ?? "");
  const [companyId, setCompanyId] = useState(defaultValues?.companyId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onSubmit({ name, email, phone, title, companyId });
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
        <Label htmlFor="contact-form-name">Name</Label>
        <Input
          id="contact-form-name"
          data-testid="contact-form-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-form-email">Email</Label>
        <Input
          id="contact-form-email"
          data-testid="contact-form-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-form-phone">Phone</Label>
        <Input
          id="contact-form-phone"
          data-testid="contact-form-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-form-title">Title</Label>
        <Input
          id="contact-form-title"
          data-testid="contact-form-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-form-company">Company</Label>
        <select
          id="contact-form-company"
          data-testid="contact-form-company"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600"
        >
          {error}
        </p>
      )}
      <Button type="submit" data-testid="contact-form-submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
