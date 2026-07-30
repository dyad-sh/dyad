"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  orgId: string;
};

export function CreateProjectForm({ orgId }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const res = await fetch(`/api/orgs/${orgId}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!res.ok || !data.id) {
        setError(data.error ?? "Failed to create project");
        setPending(false);
        return;
      }
      router.push(`/orgs/${orgId}/projects/${data.id}`);
      router.refresh();
    } catch {
      setError("Failed to create project");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="project-name">Name</Label>
        <Input
          id="project-name"
          data-testid="project-name-input"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="project-description">Description</Label>
        <Textarea
          id="project-description"
          data-testid="project-description-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        data-testid="project-create-submit"
        disabled={pending}
      >
        {pending ? "Creating…" : "Create project"}
      </Button>
    </form>
  );
}
