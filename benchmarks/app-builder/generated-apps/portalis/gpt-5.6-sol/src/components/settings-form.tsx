"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Organization } from "@/lib/organizations";

const schema = z.object({ name: z.string().trim().min(1), description: z.string().max(1000) });
type Values = z.infer<typeof schema>;

export function SettingsForm({ organization }: { organization: Organization }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: organization.name, description: organization.description } });

  async function onSubmit(values: Values) {
    setSaved(false); setError("");
    const response = await fetch(`/api/organizations/${organization.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (!response.ok) { const data = await response.json(); setError(data.error ?? "Unable to save changes."); return; }
    setSaved(true); router.refresh();
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-2"><Label htmlFor="settings-name">Name</Label><Input id="settings-name" className="h-11" data-testid="settings-name-input" {...register("name")} /></div>
      <div className="space-y-2"><Label htmlFor="settings-description">Description</Label><Textarea id="settings-description" rows={5} placeholder="What does this organization do?" data-testid="settings-description-input" {...register("description")} /></div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <div className="flex items-center gap-4"><Button type="submit" className="bg-sky-600 hover:bg-sky-700" disabled={isSubmitting} data-testid="settings-save">{isSubmitting && <Loader2 className="animate-spin" />}Save changes</Button>{saved && <span className="text-sm font-medium text-emerald-700" data-testid="settings-saved">Changes saved</span>}</div>
    </form>
  );
}
