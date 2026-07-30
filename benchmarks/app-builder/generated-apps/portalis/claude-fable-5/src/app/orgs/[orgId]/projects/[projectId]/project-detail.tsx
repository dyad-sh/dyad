"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ProjectDetail({
  orgId,
  project,
  isAdmin,
}: {
  orgId: string;
  project: { id: string; name: string; description: string };
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/orgs/${orgId}/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not save the project.");
      return;
    }
    setSaved(true);
    router.refresh();
  };

  const onDelete = async () => {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/orgs/${orgId}/projects/${project.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not delete the project.");
      setDeleting(false);
      setConfirmingDelete(false);
      return;
    }
    router.push(`/orgs/${orgId}/projects`);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <h2
        data-testid="project-detail-name"
        className="text-xl font-semibold tracking-tight"
      >
        {project.name}
      </h2>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Edit project</CardTitle>
          <CardDescription>
            Update the project&apos;s name and description.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="space-y-4">
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-edit-description">Description</Label>
              <Textarea
                id="project-edit-description"
                data-testid="project-edit-description-input"
                rows={4}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button type="submit" data-testid="project-save" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {saved && (
                <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600">
                  <Check className="h-4 w-4" />
                  Saved
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="max-w-lg border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Danger zone
            </CardTitle>
            <CardDescription>
              Deleting a project is permanent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <Button
                  data-testid="project-delete-confirm"
                  variant="destructive"
                  onClick={onDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Confirm delete"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                data-testid="project-delete"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete project
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
