"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export function NewProjectForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/orgs/${orgId}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not create the project.");
      setLoading(false);
      return;
    }
    const project = await res.json();
    router.push(`/orgs/${orgId}/projects/${project.id}`);
    router.refresh();
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>New project</CardTitle>
        <CardDescription>
          Projects are visible to everyone in this organization.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              data-testid="project-name-input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Website redesign"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              data-testid="project-description-input"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
            />
          </div>
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            data-testid="project-create-submit"
            disabled={loading}
          >
            {loading ? "Creating…" : "Create project"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
