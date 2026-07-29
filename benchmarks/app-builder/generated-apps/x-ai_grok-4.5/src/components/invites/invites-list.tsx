"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export type InviteItem = {
  id: string;
  email: string;
  workspaceId: string;
  name: string;
};

export function InvitesList({ invites }: { invites: InviteItem[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const acceptInvite = async (inviteId: string) => {
    setLoadingId(inviteId);
    try {
      const response = await fetch(`/api/invites/${inviteId}/accept`, {
        method: "POST",
      });
      if (response.ok) {
              window.dispatchEvent(new Event("workspace-changed"));
              router.refresh();
            }
    } finally {
      setLoadingId(null);
    }
  };

  if (invites.length === 0) {
    return (
      <div data-testid="invites-list">
        <p
          data-testid="invites-empty"
          className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500"
        >
          You have no pending invites.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="invites-list">
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {invites.map((invite) => (
          <li
            key={invite.id}
            data-testid="invite-row"
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <span
              data-testid="invite-row-workspace"
              className="font-medium text-slate-900"
            >
              {invite.name}
            </span>
            <Button
              type="button"
              size="sm"
              data-testid="invite-accept-button"
              disabled={loadingId === invite.id}
              onClick={() => void acceptInvite(invite.id)}
            >
              {loadingId === invite.id ? "Accepting…" : "Accept"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
