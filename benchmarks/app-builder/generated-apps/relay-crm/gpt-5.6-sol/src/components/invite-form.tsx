'use client';

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch(`/api/workspaces/${workspaceId}/invites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error || "Unable to invite member"); return; }
    setEmail(""); router.refresh();
  };
  return <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-semibold text-slate-950">Invite a teammate</h2><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_auto]"><Input type="email" placeholder="teammate@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required data-testid="invite-email-input" /><select className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value as "member" | "viewer")} data-testid="invite-role-select"><option value="member">Member</option><option value="viewer">Viewer</option></select><Button type="submit" disabled={saving} data-testid="invite-submit">{saving ? "Sending…" : "Send invite"}</Button></div><p className="mt-3 min-h-5 text-sm text-red-600" role="alert" data-testid="invite-error">{error}</p></form>;
}
