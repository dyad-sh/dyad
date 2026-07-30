'use client';

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = { orgId: string; name: string; description: string };

export function SettingsForm({ orgId, name, description }: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaved(false); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/orgs/${orgId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) });
    if (!response.ok) { const body = await response.json(); setError(body.error ?? "Unable to save changes."); return; }
    setSaved(true); router.refresh();
  }
  return <form onSubmit={submit} className="space-y-6"><label className="block text-sm font-medium text-slate-700">Organization name<Input data-testid="settings-name-input" name="name" defaultValue={name} required className="mt-2 h-11" /></label><label className="block text-sm font-medium text-slate-700">Description<Textarea data-testid="settings-description-input" name="description" defaultValue={description} className="mt-2 min-h-32" /></label>{error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<div className="flex items-center gap-4"><Button data-testid="settings-save" className="bg-blue-600 hover:bg-blue-700">Save changes</Button>{saved && <span data-testid="settings-saved" className="text-sm font-medium text-emerald-600">Changes saved</span>}</div></form>;
}
