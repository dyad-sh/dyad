"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Company } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export function CompanyForm({ company }: { company?: Company }) {
  const router = useRouter();
  const [name, setName] = useState(company?.name ?? "");
  const [domain, setDomain] = useState(company?.domain ?? "");
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
        company ? `/api/companies/${company.id}` : "/api/companies",
        {
          method: company ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), domain }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not save this company.");
        return;
      }
      router.push(`/companies/${company ? company.id : body.id}`);
      router.refresh();
    } catch {
      setError("Could not save this company.");
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
        <label htmlFor="company-name" className="text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="company-name"
          data-testid="company-form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="company-domain" className="text-sm font-medium text-slate-700">
          Domain
        </label>
        <input
          id="company-domain"
          data-testid="company-form-domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="acme.com"
          className={inputClass}
        />
      </div>

      {error ? (
        <p
          data-testid="company-form-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : (
        <p data-testid="company-form-error" className="hidden" />
      )}

      <button
        type="submit"
        data-testid="company-form-submit"
        disabled={saving}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? "Saving…" : company ? "Save changes" : "Create company"}
      </button>
    </form>
  );
}
