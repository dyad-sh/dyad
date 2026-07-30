"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOrganizationAction } from "@/app/orgs/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const derivedSlug = useMemo(() => slugify(name), [name]);

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createOrganizationAction({
        name,
        slug: slug || derivedSlug,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.orgId) {
        router.push(`/orgs/${result.orgId}`);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="org-name">Organization name</Label>
        <Input
          id="org-name"
          data-testid="org-name-input"
          name="name"
          required
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Acme Corp"
          className="h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="org-slug">Slug</Label>
        <Input
          id="org-slug"
          data-testid="org-slug-input"
          name="slug"
          required
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          placeholder="acme-corp"
          className="h-11 font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, numbers, and hyphens. Must be unique.
        </p>
      </div>

      {error ? (
        <p
          data-testid="create-org-error"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        data-testid="create-org-submit"
        className="h-11 w-full sm:w-auto"
        disabled={pending}
      >
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
