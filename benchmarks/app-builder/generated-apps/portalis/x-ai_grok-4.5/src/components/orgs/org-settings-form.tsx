"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrganizationAction } from "@/app/orgs/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  orgId: string;
  initialName: string;
  initialDescription: string;
};

export function OrgSettingsForm({
  orgId,
  initialName,
  initialDescription,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await updateOrganizationAction({
        orgId,
        name,
        description,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="settings-name">Name</Label>
        <Input
          id="settings-name"
          data-testid="settings-name-input"
          name="name"
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
        <Label htmlFor="settings-description">Description</Label>
        <Textarea
          id="settings-description"
          data-testid="settings-description-input"
          name="description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setSaved(false);
          }}
          rows={4}
          placeholder="What does this organization do?"
          className="resize-y"
        />
      </div>

      {error ? (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {saved ? (
        <p
          data-testid="settings-saved"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          role="status"
        >
          Settings saved.
        </p>
      ) : null}

      <Button type="submit" data-testid="settings-save" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
