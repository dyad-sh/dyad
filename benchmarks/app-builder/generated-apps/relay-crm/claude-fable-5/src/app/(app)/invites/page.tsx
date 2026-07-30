'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Invite = {
  id: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
};

export default function InvitesPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/invites')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Invite[]) => setInvites(data))
      .finally(() => setLoading(false));
  }, []);

  const handleAccept = async (id: string) => {
    setAcceptingId(id);
    const res = await fetch(`/api/invites/${id}/accept`, { method: 'POST' });
    if (res.ok) {
      // Reload so the workspace switcher picks up the new membership.
      window.location.reload();
    } else {
      setAcceptingId(null);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Invites</h1>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : invites.length === 0 ? (
        <div
          data-testid="invites-empty"
          className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500"
        >
          No pending invites.
        </div>
      ) : (
        <ul
          data-testid="invites-list"
          className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          {invites.map((invite) => (
            <li
              key={invite.id}
              data-testid="invite-row"
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div>
                <p data-testid="invite-row-workspace" className="font-medium text-slate-900">
                  {invite.workspaceName}
                </p>
                <p className="text-sm text-slate-500">
                  Invited as {invite.email}
                </p>
              </div>
              <Button
                data-testid="invite-accept-button"
                disabled={acceptingId === invite.id}
                onClick={() => handleAccept(invite.id)}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {acceptingId === invite.id ? 'Accepting…' : 'Accept'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
