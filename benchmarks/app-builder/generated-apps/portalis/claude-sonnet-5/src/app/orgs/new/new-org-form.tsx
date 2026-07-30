"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function NewOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, description }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Could not create organization.");
      }

      router.push(`/orgs/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create organization.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <h1 className="text-2xl font-bold text-foreground">
        Create organization
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Set up a new organization for your team.
      </p>

      <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization name</Label>
            <Input
              id="org-name"
              required
              placeholder="Acme Inc."
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              data-testid="org-name-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-slug">Slug</Label>
            <Input
              id="org-slug"
              required
              placeholder="acme-inc"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              data-testid="org-slug-input"
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-description">Description (optional)</Label>
            <Textarea
              id="org-description"
              placeholder="What is this organization for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="create-org-error"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}
            data-testid="create-org-submit"
          >
            {isSubmitting ? "Creating..." : "Create organization"}
          </Button>
        </form>
      </div>
    </div>
  );
}
