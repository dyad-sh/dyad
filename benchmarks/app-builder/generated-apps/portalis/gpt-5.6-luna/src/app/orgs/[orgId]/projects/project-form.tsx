'use client';

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = { orgId: string; project?: { id: string; name: string; description: string }; canDelete?: boolean };
export function ProjectForm({ orgId, project, canDelete = false }: Props) {
  const router = useRouter(); const [error, setError] = useState(""); const [confirm, setConfirm] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const path = project ? `/api/orgs/${orgId}/projects/${project.id}` : `/api/orgs/${orgId}/projects`; const response = await fetch(path, { method: project ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) }); const body = await response.json().catch(() => ({})); if (!response.ok) { setError(body.error ?? "Unable to save project."); return; } router.push(project ? `/orgs/${orgId}/projects/${project.id}` : `/orgs/${orgId}/projects`); router.refresh(); }
  async function remove() { const response = await fetch(`/api/orgs/${orgId}/projects/${project?.id}`, { method: "DELETE" }); if (response.ok) router.push(`/orgs/${orgId}/projects`); }
  return <form onSubmit={save} className="space-y-6"><label className="block text-sm font-medium text-slate-700">Project name{project ? <Input data-testid="project-edit-name-input" name="name" defaultValue={project.name} required className="mt-2 h-11" /> : <Input data-testid="project-name-input" name="name" required className="mt-2 h-11" />}</label><label className="block text-sm font-medium text-slate-700">Description<Input data-testid="project-description-input" name="description" defaultValue={project?.description} className="mt-2 min-h-24 h-auto py-3" /></label>{error && <p className="text-sm text-red-600">{error}</p>}<div className="flex flex-wrap gap-3"><Button data-testid={project ? "project-save" : "project-create-submit"} className="bg-blue-600 hover:bg-blue-700">{project ? "Save changes" : "Create project"}</Button>{project && canDelete && (confirm ? <Button type="button" data-testid="project-delete-confirm" variant="destructive" onClick={remove}>Confirm delete</Button> : <Button type="button" data-testid="project-delete" variant="outline" onClick={() => setConfirm(true)}>Delete project</Button>)}</div></form>;
}
