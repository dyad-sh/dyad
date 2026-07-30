"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { OrgRole } from "@/lib/roles";

type Props = {
  orgId: string;
  userId: string;
  role: OrgRole;
  isSelf: boolean;
};

export function MemberRowActions({ orgId, userId, role, isSelf }: Props) {
  const router = useRouter();
  const [currentRole, setCurrentRole] = useState<OrgRole>(role);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRoleChange(next: OrgRole) {
    if (next === currentRole) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to update role");
        setPending(false);
        return;
      }
      setCurrentRole(next);
      setPending(false);
      router.refresh();
    } catch {
      setError("Failed to update role");
      setPending(false);
    }
  }

  async function onRemove() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to remove member");
        setPending(false);
        setConfirmRemove(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to remove member");
      setPending(false);
      setConfirmRemove(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <select
          data-testid="member-role-select"
          value={currentRole}
          disabled={pending}
          onChange={(e) => onRoleChange(e.target.value as OrgRole)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="org_admin">org_admin</option>
          <option value="org_member">org_member</option>
        </select>

        {!confirmRemove ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="member-remove"
            disabled={pending}
            onClick={() => setConfirmRemove(true)}
          >
            {isSelf ? "Leave" : "Remove"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            data-testid="member-remove-confirm"
            disabled={pending}
            onClick={onRemove}
          >
            Confirm remove
          </Button>
        )}
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
