"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CompanyFormValues = {
  name: string;
  domain: string;
};

export function CompanyForm({
  defaultValues,
  onSubmit,
  submitLabel,
}: {
  defaultValues?: Partial<CompanyFormValues>;
  onSubmit: (values: CompanyFormValues) => Promise<string | void>;
  submitLabel: string;
}) {
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [domain, setDomain] = useState(defaultValues?.domain ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onSubmit({ name, domain });
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
        <Label htmlFor="company-form-name">Name</Label>
        <Input
          id="company-form-name"
          data-testid="company-form-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="company-form-domain">Domain</Label>
        <Input
          id="company-form-domain"
          data-testid="company-form-domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
        />
      </div>
      {error && (
        <p
          data-testid="company-form-error"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600"
        >
          {error}
        </p>
      )}
      <Button type="submit" data-testid="company-form-submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
