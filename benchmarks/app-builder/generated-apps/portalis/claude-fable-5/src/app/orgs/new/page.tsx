"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function NewOrgPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not create the organization.");
        setLoading(false);
        return;
      }
      router.push(`/orgs/${body.id}`);
      router.refresh();
    } catch {
      setError("Could not create the organization.");
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Create an organization</CardTitle>
          <CardDescription>
            Organizations group your team, settings, and members.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                data-testid="org-name-input"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugEdited) setSlug(slugify(e.target.value));
                }}
                placeholder="Acme Inc."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-slug">Slug</Label>
              <Input
                id="org-slug"
                data-testid="org-slug-input"
                required
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value);
                }}
                placeholder="acme-inc"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens. Must be unique.
              </p>
            </div>
            {error && (
              <p
                data-testid="create-org-error"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              data-testid="create-org-submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? "Creating…" : "Create organization"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
