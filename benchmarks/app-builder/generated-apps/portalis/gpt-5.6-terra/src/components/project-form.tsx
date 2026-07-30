"use client";

import { FormEvent, useState } from "react";

export function ProjectForm({ orgId, project, mode }: { orgId: string; project?: { id: string; name: string; description: string }; mode: "create" | "edit" }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(mode === "create" ? `/api/orgs/${orgId}/projects` : `/api/orgs/${orgId}/projects/${project!.id}`, { method: mode === "create" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Unable to save project."); setSaving(false); return; }
    window.location.assign(`/orgs/${orgId}/projects/${body.id}`);
  }

  return <form onSubmit={submit} className="mt-8 max-w-2xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><label className="block text-sm font-medium">Project name<input data-testid={mode === "create" ? "project-name-input" : "project-edit-name-input"} name="name" required defaultValue={project?.name} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-sky-500" /></label><label className="block text-sm font-medium">Description<textarea data-testid="project-description-input" name="description" rows={5} defaultValue={project?.description} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-sky-500" /></label>{error && <p className="text-sm text-red-700">{error}</p>}<button data-testid={mode === "create" ? "project-create-submit" : "project-save"} disabled={saving} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">{saving ? "Saving…" : mode === "create" ? "Create project" : "Save changes"}</button></form>;
}

export function DeleteProject({ orgId, projectId, isAdmin }: { orgId: string; projectId: string; isAdmin: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  if (!isAdmin) return null;
  async function remove() {
    const response = await fetch(`/api/orgs/${orgId}/projects/${projectId}`, { method: "DELETE" });
    if (!response.ok) { setError((await response.json()).error ?? "Unable to delete project."); return; }
    window.location.assign(`/orgs/${orgId}/projects`);
  }
  return <div className="mt-8 border-t border-slate-200 pt-6">{error && <p className="mb-3 text-sm text-red-700">{error}</p>}{confirming ? <button data-testid="project-delete-confirm" onClick={remove} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-white">Confirm delete</button> : <button data-testid="project-delete" onClick={() => setConfirming(true)} className="rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-700">Delete project</button>}</div>;
}
