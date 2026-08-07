"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateOrgAction } from "@/app/actions/orgs";

export function SettingsForm({
  orgId,
  initialName,
  initialDescription,
}: {
  orgId: string;
  initialName: string;
  initialDescription: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);
    const result = await updateOrgAction({ orgId, name, description });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label
          htmlFor="settings-name"
          className="block text-sm font-medium text-slate-700"
        >
          Organization name
        </label>
        <input
          id="settings-name"
          data-testid="settings-name-input"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="settings-description"
          className="block text-sm font-medium text-slate-700"
        >
          Description
        </label>
        <textarea
          id="settings-description"
          data-testid="settings-description-input"
          rows={4}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setSaved(false);
          }}
          placeholder="What does this organization do?"
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          data-testid="settings-save"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        {saved && (
          <span
            data-testid="settings-saved"
            role="status"
            className="text-sm font-medium text-emerald-600"
          >
            Changes saved
          </span>
        )}
      </div>
    </form>
  );
}
