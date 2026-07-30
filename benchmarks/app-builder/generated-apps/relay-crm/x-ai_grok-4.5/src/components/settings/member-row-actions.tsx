"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { MembershipRole } from "@/lib/types";

const ROLES: MembershipRole[] = ["owner", "member", "viewer"];

type MemberRowActionsProps = {
  workspaceId: string;
  memberId: string;
  currentRole: MembershipRole;
  isSelf: boolean;
};

export function MemberRowActions({
  workspaceId,
  memberId,
  currentRole,
  isSelf,
}: MemberRowActionsProps) {
  const router = useRouter();
  const [role, setRole] = useState<MembershipRole>(currentRole);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const saveRole = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/members/${memberId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to update role");
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to update role");
    } finally {
      setLoading(false);
    }
  };

  const removeMember = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/members/${memberId}`,
        { method: "DELETE" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to remove member");
        setLoading(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to remove member");
      setLoading(false);
    }
  };

  if (isSelf) {
    return (
      <span className="text-xs text-slate-500">You</span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        data-testid="member-role-select"
        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={role}
        disabled={loading}
        onChange={(e) => setRole(e.target.value as MembershipRole)}
      >
        {ROLES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="member-role-save"
        disabled={loading || role === currentRole}
        onClick={() => void saveRole()}
      >
        Save
      </Button>
      <Button
        type="button"
        size="sm"
        variant={confirming ? "outline" : "destructive"}
        data-testid="member-remove-button"
        disabled={loading}
        onClick={() => setConfirming(true)}
      >
        Remove
      </Button>
      {confirming ? (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          data-testid="member-remove-confirm"
          disabled={loading}
          onClick={() => void removeMember()}
        >
          Confirm
        </Button>
      ) : null}
      {error ? <p className="w-full text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
