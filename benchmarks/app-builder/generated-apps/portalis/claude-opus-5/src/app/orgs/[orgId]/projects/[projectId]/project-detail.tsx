"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/orgs";

export function ProjectDetail({
  orgId,
  project,
  canDelete,
}: {
  orgId: string;
  project: Project;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);
    const res = await fetch(`/api/orgs/${orgId}/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save the project.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function remove() {
    setError(null);
    const res = await fetch(`/api/orgs/${orgId}/projects/${project.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not delete the project.");
      return;
    }
    router.replace(`/orgs/${orgId}/projects`);
    router.refresh();
  }

  return (
    <div className="max-w-lg space-y-6">
      <h2
        data-testid="project-detail-name"
        className="text-xl font-semibold tracking-tight text-slate-900"
      >
        {project.name}
      </h2>

      <form
        onSubmit={save}
        className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        noValidate
      >
        <div className="space-y-1.5">
          <label
            htmlFor="project-edit-name"
            className="block text-sm font-medium text-slate-700"
          >
            Project name
          </label>
          <input
            id="project-edit-name"
            data-testid="project-edit-name-input"
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
            htmlFor="project-edit-description"
            className="block text-sm font-medium text-slate-700"
          >
            Description
          </label>
          <textarea
            id="project-edit-description"
            data-testid="project-description-input"
            rows={4}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setSaved(false);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
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
            data-testid="project-save"
            disabled={pending}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
          {saved && (
            <span
              role="status"
              className="text-sm font-medium text-emerald-600"
            >
              Changes saved
            </span>
          )}
        </div>
      </form>

      {canDelete && (
        <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">
            Delete project
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            This permanently removes the project from this organization.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              data-testid="project-delete"
              onClick={() => setConfirming((v) => !v)}
              className="rounded-lg border border-red-200 px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
            >
              Delete project
            </button>
            {confirming && (
              <button
                type="button"
                data-testid="project-delete-confirm"
                onClick={remove}
                className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                Confirm delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
