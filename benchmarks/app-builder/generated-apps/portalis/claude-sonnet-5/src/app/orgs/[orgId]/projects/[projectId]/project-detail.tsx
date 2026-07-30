"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Project {
  id: string;
  name: string;
  description: string | null;
}

export function ProjectDetail({
  orgId,
  project,
  isAdmin,
}: {
  orgId: string;
  project: Project;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Could not save changes.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/projects/${project.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not delete project.");
      }
      router.push(`/orgs/${orgId}/projects`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete project.");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1
        data-testid="project-detail-name"
        className="text-2xl font-bold text-foreground"
      >
        {project.name}
      </h1>

      <form
        onSubmit={handleSave}
        className="mt-6 space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <div className="space-y-2">
          <Label htmlFor="project-edit-name">Project name</Label>
          <Input
            id="project-edit-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="project-edit-name-input"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-edit-description">Description</Label>
          <Textarea
            id="project-edit-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="project-edit-description-input"
          />
        </div>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving} data-testid="project-save">
            {saving ? "Saving..." : "Save changes"}
          </Button>

          {isAdmin &&
            (confirmingDelete ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleting}
                  onClick={handleDelete}
                  data-testid="project-delete-confirm"
                >
                  {deleting ? "Deleting..." : "Confirm delete"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={deleting}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmingDelete(true)}
                data-testid="project-delete"
              >
                Delete project
              </Button>
            ))}
        </div>
      </form>
    </div>
  );
}
