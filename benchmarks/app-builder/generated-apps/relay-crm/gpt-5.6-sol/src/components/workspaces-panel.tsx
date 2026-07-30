'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Workspace = { id: string; name: string };

export function WorkspacesPanel({ initialWorkspaces, canCreate }: { initialWorkspaces: Workspace[]; canCreate: boolean }) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);

  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error || "Unable to create workspace"); return; }
    setWorkspaces((current) => [...current, data]); setName(""); setShowForm(false); router.refresh();
  };

  return <div><div className="mb-8 flex items-end justify-between"><div><p className="text-sm font-medium text-indigo-600">Account</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Workspaces</h1><p className="mt-2 text-sm text-slate-500">Create and switch between your teams.</p></div>{canCreate && <Button onClick={() => setShowForm((value) => !value)} data-testid="workspace-create-button"><Plus /> New workspace</Button>}</div>{canCreate && showForm && <form onSubmit={create} className="mb-6 max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><div className="space-y-2"><Label htmlFor="workspace-name">Workspace name</Label><Input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} required data-testid="workspace-form-name" /></div>{error && <p className="text-sm text-red-600">{error}</p>}<Button type="submit" disabled={saving} data-testid="workspace-form-submit">{saving ? "Creating…" : "Create workspace"}</Button></form>}<div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="workspace-list">{workspaces.map((workspace) => <div key={workspace.id} className="flex items-center justify-between border-b border-slate-100 p-5 last:border-0" data-testid="workspace-row"><span className="font-medium text-slate-900" data-testid="workspace-row-name">{workspace.name}</span></div>)}</div></div>;
}
