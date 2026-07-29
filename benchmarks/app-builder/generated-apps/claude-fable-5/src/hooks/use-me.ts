'use client';

import { useEffect, useState } from 'react';

export type Me = {
  id: string;
  email: string;
  name: string;
  activeWorkspaceId: string;
  memberships: {
    workspaceId: string;
    workspaceName: string;
    membershipId: string;
    role: string;
  }[];
};

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Me | null) => setMe(data))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const activeRole =
    me?.memberships.find((m) => m.workspaceId === me.activeWorkspaceId)?.role ??
    null;
  const canWrite = activeRole === 'owner' || activeRole === 'member';
  const isOwner = activeRole === 'owner';

  return { me, loading, activeRole, canWrite, isOwner };
}
