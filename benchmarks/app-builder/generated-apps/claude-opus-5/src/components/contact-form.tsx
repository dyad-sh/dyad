"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Company, ContactWithCompany } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export function ContactForm({
  companies,
  contact,
}: {
  companies: Company[];
  contact?: ContactWithCompany;
}) {
  const router = useRouter();
  const [name, setName] = useState(contact?.name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [title, setTitle] = useState(contact?.title ?? "");
  const [companyId, setCompanyId] = useState(contact?.company_id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        contact ? `/api/contacts/${contact.id}` : "/api/contacts",
        {
          method: contact ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            email,
            phone,
            title,
            company_id: companyId,
          }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not save this contact.");
        return;
      }
      router.push(`/contacts/${contact ? contact.id : body.id}`);
      router.refresh();
    } catch {
      setError("Could not save this contact.");
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
        <label htmlFor="contact-name" className="text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="contact-name"
          data-testid="contact-form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="contact-email" className="text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="contact-email"
          data-testid="contact-form-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="contact-phone" className="text-sm font-medium text-slate-700">
          Phone
        </label>
        <input
          id="contact-phone"
          data-testid="contact-form-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="contact-title" className="text-sm font-medium text-slate-700">
          Title
        </label>
        <input
          id="contact-title"
          data-testid="contact-form-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="contact-company" className="text-sm font-medium text-slate-700">
          Company
        </label>
        <select
          id="contact-company"
          data-testid="contact-form-company"
          value={companyId ?? ""}
          onChange={(e) => setCompanyId(e.target.value)}
          className={inputClass}
        >
          <option value="">No company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p
          data-testid="contact-form-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : (
        <p data-testid="contact-form-error" className="hidden" />
      )}

      <button
        type="submit"
        data-testid="contact-form-submit"
        disabled={saving}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? "Saving…" : contact ? "Save changes" : "Create contact"}
      </button>
    </form>
  );
}
