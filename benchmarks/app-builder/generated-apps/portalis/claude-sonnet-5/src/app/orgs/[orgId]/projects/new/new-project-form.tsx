"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function NewProjectForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/orgs/${orgId}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Could not create project.");
      }

      router.push(`/orgs/${orgId}/projects/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-foreground">New project</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add a project to this organization.
      </p>

      <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              required
              placeholder="Website redesign"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="project-name-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              rows={4}
              placeholder="What is this project about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="project-description-input"
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}
            data-testid="project-create-submit"
          >
            {isSubmitting ? "Creating..." : "Create project"}
          </Button>
        </form>
      </div>
    </div>
  );
}
