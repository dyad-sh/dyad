"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  orgId: string;
  projectId: string;
  initialName: string;
  initialDescription: string;
  canDelete: boolean;
};

export function ProjectDetail({
  orgId,
  projectId,
  initialName,
  initialDescription,
  canDelete,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(
        `/api/orgs/${orgId}/projects/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to save project");
        setPending(false);
        return;
      }
      setSaved(true);
      setPending(false);
      router.refresh();
    } catch {
      setError("Failed to save project");
      setPending(false);
    }
  }

  async function onDelete() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${orgId}/projects/${projectId}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to delete project");
        setPending(false);
        setConfirmDelete(false);
        return;
      }
      router.push(`/orgs/${orgId}/projects`);
      router.refresh();
    } catch {
      setError("Failed to delete project");
      setPending(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2
          data-testid="project-detail-name"
          className="text-2xl font-semibold tracking-tight"
        >
          {name}
        </h2>
      </div>

      <form onSubmit={onSave} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="project-edit-name">Name</Label>
          <Input
            id="project-edit-name"
            data-testid="project-edit-name-input"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            className="h-11"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-edit-description">Description</Label>
          <Textarea
            id="project-edit-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setSaved(false);
            }}
            rows={4}
          />
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="text-sm text-emerald-700" role="status">
            Project saved.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" data-testid="project-save" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>

          {canDelete ? (
            !confirmDelete ? (
              <Button
                type="button"
                variant="outline"
                data-testid="project-delete"
                disabled={pending}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                data-testid="project-delete-confirm"
                disabled={pending}
                onClick={onDelete}
              >
                Confirm delete
              </Button>
            )
          ) : null}
        </div>
      </form>
    </div>
  );
}
