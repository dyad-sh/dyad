"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Workspace = { id: string; name: string; role: string };

export function WorkspacesPanel({
  workspaces,
  activeId,
}: {
  workspaces: Workspace[];
  activeId: string;
}) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
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
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not create this workspace.");
        return;
      }
      setName("");
      router.refresh();
    } catch {
      setError("Could not create this workspace.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Workspaces
        </h1>
        <button
          type="button"
          data-testid="workspace-create-button"
          onClick={() => nameRef.current?.focus()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          New workspace
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        noValidate
        className="max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-6"
      >
        <div className="space-y-1.5">
          <label
            htmlFor="workspace-name"
            className="text-sm font-medium text-slate-700"
          >
            Workspace name
          </label>
          <input
            id="workspace-name"
            ref={nameRef}
            data-testid="workspace-form-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        {error ? (
          <p
            data-testid="workspace-form-error"
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        ) : (
          <p data-testid="workspace-form-error" className="hidden" />
        )}
        <button
          type="submit"
          data-testid="workspace-form-submit"
          disabled={saving}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Creating…" : "Create workspace"}
        </button>
      </form>

      <div
        data-testid="workspace-list"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <ul className="divide-y divide-slate-100">
          {workspaces.map((w) => (
            <li
              key={w.id}
              data-testid="workspace-row"
              data-workspace-id={w.id}
              className="flex items-center gap-4 px-4 py-3"
            >
              <span
                data-testid="workspace-row-name"
                className="text-sm font-medium text-slate-900"
              >
                {w.name}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {w.role}
              </span>
              {w.id === activeId ? (
                <span className="ml-auto text-xs font-medium text-emerald-600">
                  Active
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
