"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ProjectForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch(`/api/orgs/${orgId}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error ?? "Unable to create the project."); return; }
    router.push(`/orgs/${orgId}/projects/${data.id}`); router.refresh();
  }
  return <form className="space-y-6" onSubmit={submit}><div className="space-y-2"><Label htmlFor="project-name">Name</Label><Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} required data-testid="project-name-input" /></div><div className="space-y-2"><Label htmlFor="project-description">Description</Label><Textarea id="project-description" rows={6} value={description} onChange={(event) => setDescription(event.target.value)} data-testid="project-description-input" /></div>{error && <p className="text-sm text-red-700">{error}</p>}<Button type="submit" disabled={busy} className="bg-sky-600 hover:bg-sky-700" data-testid="project-create-submit">{busy && <Loader2 className="animate-spin" />}Create project</Button></form>;
}
