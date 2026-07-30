"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Project } from "@/lib/organizations";

export function ProjectDetailForm({ orgId, project, canDelete }: { orgId: string; project: Project; canDelete: boolean }) {
  const router = useRouter(); const [name, setName] = useState(project.name); const [description, setDescription] = useState(project.description); const [error, setError] = useState(""); const [saved, setSaved] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  async function save(event: React.FormEvent) { event.preventDefault(); setSaved(false); setError(""); const response = await fetch(`/api/orgs/${orgId}/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description }) }); if (!response.ok) { const data = await response.json(); setError(data.error ?? "Unable to save the project."); return; } setSaved(true); router.refresh(); }
  async function remove() { const response = await fetch(`/api/orgs/${orgId}/projects/${project.id}`, { method: "DELETE" }); if (!response.ok) { const data = await response.json(); setError(data.error ?? "Unable to delete the project."); return; } router.push(`/orgs/${orgId}/projects`); router.refresh(); }
  return <form className="space-y-6" onSubmit={save}><div className="space-y-2"><Label htmlFor="project-edit-name">Name</Label><Input id="project-edit-name" value={name} onChange={(event) => setName(event.target.value)} data-testid="project-edit-name-input" /></div><div className="space-y-2"><Label htmlFor="project-edit-description">Description</Label><Textarea id="project-edit-description" rows={6} value={description} onChange={(event) => setDescription(event.target.value)} /></div>{error && <p className="text-sm text-red-700">{error}</p>}<div className="flex flex-wrap items-center gap-3"><Button type="submit" className="bg-sky-600 hover:bg-sky-700" data-testid="project-save">Save project</Button>{saved && <span className="text-sm text-emerald-700">Saved</span>}{canDelete && (confirmDelete ? <Button type="button" variant="destructive" onClick={remove} data-testid="project-delete-confirm">Confirm delete</Button> : <Button type="button" variant="outline" className="ml-auto text-red-700" onClick={() => setConfirmDelete(true)} data-testid="project-delete">Delete project</Button>)}</div></form>;
}
