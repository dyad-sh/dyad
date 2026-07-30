"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function SettingsForm({
  orgId,
  initialName,
  initialDescription,
}: {
  orgId: string;
  initialName: string;
  initialDescription: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/orgs/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error ?? "Could not save changes.");
      }

      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-semibold text-foreground">
        Organization settings
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Update your organization&apos;s profile information.
      </p>

      <div className="mt-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <form
          onSubmit={handleSubmit}
          className="space-y-5"
          onChange={() => setSaved(false)}
        >
          <div className="space-y-2">
            <Label htmlFor="settings-name">Organization name</Label>
            <Input
              id="settings-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="settings-name-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-description">Description</Label>
            <Textarea
              id="settings-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="settings-description-input"
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={isSubmitting}
              data-testid="settings-save"
            >
              {isSubmitting ? "Saving..." : "Save changes"}
            </Button>
            {saved && (
              <span
                className="text-sm font-medium text-green-600"
                data-testid="settings-saved"
              >
                Saved
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
