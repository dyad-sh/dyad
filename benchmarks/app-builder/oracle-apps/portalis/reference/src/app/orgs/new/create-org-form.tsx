"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createOrgAction } from "@/app/actions/orgs";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await createOrgAction({ name, slug });
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.replace(`/orgs/${result.orgId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label
          htmlFor="org-name"
          className="block text-sm font-medium text-slate-700"
        >
          Organization name
        </label>
        <input
          id="org-name"
          data-testid="org-name-input"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
          placeholder="Acme Inc"
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="org-slug"
          className="block text-sm font-medium text-slate-700"
        >
          Slug
        </label>
        <input
          id="org-slug"
          data-testid="org-slug-input"
          type="text"
          value={slug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value);
          }}
          placeholder="acme"
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
        <p className="text-xs text-slate-500">
          Lowercase letters, numbers and dashes. Must be unique.
        </p>
      </div>

      {error && (
        <p
          data-testid="create-org-error"
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        data-testid="create-org-submit"
        disabled={pending}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}
