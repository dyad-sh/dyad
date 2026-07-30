'use client';

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { WorkspaceRole } from "@/lib/workspace";

type Member = { id: string; userId: string; email: string; role: WorkspaceRole };

export function MemberManager({ workspaceId, currentUserId, initialMembers }: { workspaceId: string; currentUserId: string; initialMembers: Member[] }) {
  const [members, setMembers] = useState(initialMembers);
  const [drafts, setDrafts] = useState<Record<string, WorkspaceRole>>(() => Object.fromEntries(initialMembers.map((member) => [member.id, member.role])));
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");

  const save = async (memberId: string) => {
    setError("");
    const response = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: drafts[memberId] }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error || "Unable to update role"); return; }
    setMembers((current) => current.map((member) => member.id === memberId ? { ...member, role: data.role } : member));
  };

  const remove = async (memberId: string) => {
    setError("");
    const response = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}`, { method: "DELETE" });
    if (!response.ok) { const data = await response.json(); setError(data.error || "Unable to remove member"); return; }
    setMembers((current) => current.filter((member) => member.id !== memberId)); setConfirming(null);
  };

  return <div><div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="members-list">{members.map((member) => { const isSelf = member.userId === currentUserId; return <div key={member.id} className="grid gap-3 border-b border-slate-100 p-5 last:border-0 sm:grid-cols-[1fr_150px_auto] sm:items-center" data-testid="member-row" data-user-id={member.userId}><div><span className="text-sm font-medium text-slate-900" data-testid="member-row-email">{member.email}</span><span className="ml-2 text-xs capitalize text-slate-400" data-testid="member-row-role">{member.role}</span></div><select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={drafts[member.id]} onChange={(event) => setDrafts((current) => ({ ...current, [member.id]: event.target.value as WorkspaceRole }))} disabled={isSelf} data-testid="member-role-select"><option value="owner">Owner</option><option value="member">Member</option><option value="viewer">Viewer</option></select><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => save(member.id)} disabled={isSelf || drafts[member.id] === member.role} data-testid="member-role-save">Save</Button>{confirming === member.id ? <Button size="sm" variant="destructive" onClick={() => remove(member.id)} disabled={isSelf} data-testid="member-remove-confirm">Confirm</Button> : <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setConfirming(member.id)} disabled={isSelf} data-testid="member-remove-button">Remove</Button>}</div></div>; })}</div><p className="mt-3 min-h-5 text-sm text-red-600">{error}</p></div>;
}
