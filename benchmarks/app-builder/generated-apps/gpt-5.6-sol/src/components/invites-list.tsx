'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Invite = { id: string; email: string; workspaceId: string; workspaceName: string };

export function InvitesList({ initialInvites }: { initialInvites: Invite[] }) {
  const router = useRouter();
  const [invites, setInvites] = useState(initialInvites);
  const [accepting, setAccepting] = useState<string | null>(null);
  const accept = async (id: string) => {
    setAccepting(id);
    const response = await fetch(`/api/invites/${id}/accept`, { method: "POST" });
    setAccepting(null);
    if (response.ok) { setInvites((current) => current.filter((invite) => invite.id !== id)); router.refresh(); }
  };

  if (!invites.length) return <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-500" data-testid="invites-empty">You have no pending workspace invites.</div>;
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="invites-list">{invites.map((invite) => <div key={invite.id} className="flex items-center justify-between gap-4 border-b border-slate-100 p-5 last:border-0" data-testid="invite-row"><div><p className="font-medium text-slate-900" data-testid="invite-row-workspace">{invite.workspaceName}</p><p className="mt-1 text-sm text-slate-500">Invited as {invite.email}</p></div><Button onClick={() => accept(invite.id)} disabled={accepting === invite.id} data-testid="invite-accept-button">{accepting === invite.id ? "Accepting…" : "Accept"}</Button></div>)}</div>;
}
