"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Company, Contact } from "@/lib/types";

type ContactFormProps = {
  companies: Company[];
  contact?: Contact;
  mode: "create" | "edit";
};

export function ContactForm({ companies, contact, mode }: ContactFormProps) {
  const router = useRouter();
  const [name, setName] = useState(contact?.name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [title, setTitle] = useState(contact?.title ?? "");
  const [companyId, setCompanyId] = useState(contact?.company_id ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    const payload = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      title: title.trim(),
      company_id: companyId ? companyId : null,
    };

    try {
      const response = await fetch(
        mode === "create" ? "/api/contacts" : `/api/contacts/${contact!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Failed to save contact",
        );
        return;
      }

      router.push(`/contacts/${data.id}`);
      router.refresh();
    } catch {
      setError("Failed to save contact");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="contact-form-name">Name</Label>
        <Input
          id="contact-form-name"
          data-testid="contact-form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Jane Doe"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-form-email">Email</Label>
        <Input
          id="contact-form-email"
          data-testid="contact-form-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@acme.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-form-phone">Phone</Label>
        <Input
          id="contact-form-phone"
          data-testid="contact-form-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 555 0100"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-form-title">Title</Label>
        <Input
          id="contact-form-title"
          data-testid="contact-form-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Head of Sales"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-form-company">Company</Label>
        <select
          id="contact-form-company"
          data-testid="contact-form-company"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        >
          <option value="">No company</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p
          data-testid="contact-form-error"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600"
          role="alert"
        >
          {error}
        </p>
      ) : (
        <p data-testid="contact-form-error" className="sr-only" aria-live="polite" />
      )}
      <div className="flex gap-3">
        <Button type="submit" data-testid="contact-form-submit" disabled={loading}>
          {loading
            ? "Saving…"
            : mode === "create"
              ? "Create contact"
              : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={loading}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
