"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WorkspaceInvite } from "@/lib/types";

export default function InvitesPage() {
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const load = () => {
    setIsLoading(true);
    fetch("/api/invites")
      .then((res) => (res.ok ? res.json() : []))
      .then(setInvites)
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleAccept = async (id: string) => {
    setAcceptingId(id);
    try {
      const res = await fetch(`/api/invites/${id}/accept`, { method: "POST" });
      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Invites</h1>

      {!isLoading && invites.length === 0 ? (
        <p
          data-testid="invites-empty"
          className="rounded-lg border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-500"
        >
          No pending invites.
        </p>
      ) : (
        <ul data-testid="invites-list" className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {invites.map((invite) => (
            <li key={invite.id} data-testid="invite-row" className="flex items-center justify-between px-4 py-3 text-sm">
              <span data-testid="invite-row-workspace" className="text-slate-900">
                {invite.workspaceName}
              </span>
              <Button
                size="sm"
                data-testid="invite-accept-button"
                onClick={() => handleAccept(invite.id)}
                disabled={acceptingId === invite.id}
              >
                {acceptingId === invite.id ? "Accepting..." : "Accept"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
