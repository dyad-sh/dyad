'use client';

import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown } from 'lucide-react';

type Me = {
  activeWorkspaceId: string;
  memberships: { workspaceId: string; workspaceName: string; role: string }[];
};

export function WorkspaceSwitcher() {
  const [me, setMe] = useState<Me | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Me | null) => setMe(data))
      .catch(() => setMe(null));
  }, []);

  const active = me?.memberships.find(
    (m) => m.workspaceId === me.activeWorkspaceId,
  );

  const handleSwitch = async (workspaceId: string) => {
    if (!me || workspaceId === me.activeWorkspaceId || switching) return;
    setSwitching(true);
    const res = await fetch(`/api/workspaces/${workspaceId}/activate`, {
      method: 'POST',
    });
    if (res.ok) {
      window.location.reload();
    } else {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid="workspace-switcher"
          className="max-w-56"
        >
          <span data-testid="workspace-current-name" className="truncate">
            {active?.workspaceName ?? '…'}
          </span>
          <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 text-slate-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {me?.memberships.map((m) => (
          <DropdownMenuItem
            key={m.workspaceId}
            data-testid="workspace-switcher-option"
            onClick={() => handleSwitch(m.workspaceId)}
            className="flex items-center justify-between"
          >
            <span className="truncate">{m.workspaceName}</span>
            {m.workspaceId === me.activeWorkspaceId && (
              <Check className="h-4 w-4 text-indigo-600" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
