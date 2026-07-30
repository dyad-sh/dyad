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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/orgs/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not save changes.");
      return;
    }
    setSaved(true);
    router.refresh();
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Organization profile</CardTitle>
        <CardDescription>
          These details are visible to all members.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              data-testid="settings-name-input"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-description">Description</Label>
            <Textarea
              id="settings-description"
              data-testid="settings-description-input"
              rows={4}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setSaved(false);
              }}
              placeholder="What does this organization do?"
            />
          </div>
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" data-testid="settings-save" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            {saved && (
              <span
                data-testid="settings-saved"
                className="inline-flex items-center gap-1 text-sm font-medium text-green-600"
              >
                <Check className="h-4 w-4" />
                Saved
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
