"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateProjectForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await fetch(`/api/orgs/${orgId}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not create the project.");
      setPending(false);
      return;
    }
    router.replace(`/orgs/${orgId}/projects`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label
          htmlFor="project-name"
          className="block text-sm font-medium text-slate-700"
        >
          Project name
        </label>
        <input
          id="project-name"
          data-testid="project-name-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Website redesign"
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="project-description"
          className="block text-sm font-medium text-slate-700"
        >
          Description
        </label>
        <textarea
          id="project-description"
          data-testid="project-description-input"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this project about?"
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

      <button
        type="submit"
        data-testid="project-create-submit"
        disabled={pending}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}
