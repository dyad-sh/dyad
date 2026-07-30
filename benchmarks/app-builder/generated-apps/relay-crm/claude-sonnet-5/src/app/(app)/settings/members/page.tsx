"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ForbiddenMessage } from "@/components/forbidden-message";
import type { Me, WorkspaceInvite, WorkspaceMember } from "@/lib/types";

export default function MembersPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "viewer">("member");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingRoles, setPendingRoles] = useState<Record<string, string>>({});
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = async () => {
    const meRes = await fetch("/api/me");
    if (!meRes.ok) {
      setIsLoading(false);
      return;
    }
    const meData: Me = await meRes.json();
    setMe(meData);
    if (!meData.activeWorkspaceId) {
      setIsLoading(false);
      return;
    }

    const [membersRes, invitesRes] = await Promise.all([
      fetch(`/api/workspaces/${meData.activeWorkspaceId}/members`),
      fetch(`/api/workspaces/${meData.activeWorkspaceId}/invites`),
    ]);
    if (membersRes.status === 403) {
      setForbidden(true);
      setIsLoading(false);
      return;
    }
    if (membersRes.ok) {
      const memberRows: WorkspaceMember[] = await membersRes.json();
      setMembers(memberRows);
      setPendingRoles(Object.fromEntries(memberRows.map((m) => [m.id, m.role])));
    }
    if (invitesRes.ok) setInvites(await invitesRes.json());
    setIsLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInvite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!me?.activeWorkspaceId) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${me.activeWorkspaceId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to send invite");
        return;
      }
      setEmail("");
      await load();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveRole = async (memberId: string) => {
    if (!me?.activeWorkspaceId) return;
    setRowError(null);
    const role = pendingRoles[memberId];
    const res = await fetch(`/api/workspaces/${me.activeWorkspaceId}/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRowError(data.error ?? "Failed to update role");
      return;
    }
    await load();
  };

  const handleRemove = async (memberId: string) => {
    if (!me?.activeWorkspaceId) return;
    setRowError(null);
    const res = await fetch(`/api/workspaces/${me.activeWorkspaceId}/members/${memberId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRowError(data.error ?? "Failed to remove member");
      setConfirmingRemoveId(null);
      return;
    }
    setConfirmingRemoveId(null);
    await load();
  };

  if (isLoading) {
    return null;
  }

  if (forbidden) {
    return <ForbiddenMessage />;
  }

  const activeMembership = me?.memberships.find((m) => m.workspaceId === me.activeWorkspaceId);
  const isOwner = activeMembership?.role === "owner";

  if (!isOwner) {
    return <ForbiddenMessage />;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Members</h1>

      <Card>
        <CardHeader>
          <CardTitle>Workspace members</CardTitle>
        </CardHeader>
        <CardContent>
          {rowError && <p className="mb-3 text-sm text-red-600">{rowError}</p>}
          <ul data-testid="members-list" className="divide-y divide-slate-100">
            {members.map((member) => {
              const isSelf = member.userId === me?.id;
              return (
                <li
                  key={member.id}
                  data-testid="member-row"
                  data-user-id={member.userId}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div className="flex flex-col">
                    <span data-testid="member-row-email" className="text-slate-900">
                      {member.email}
                    </span>
                    <span data-testid="member-row-role" className="text-xs text-slate-500">
                      {member.role}
                    </span>
                  </div>
                  {!isSelf && (
                    <div className="flex items-center gap-2">
                      <select
                        data-testid="member-role-select"
                        value={pendingRoles[member.id] ?? member.role}
                        onChange={(e) =>
                          setPendingRoles((prev) => ({ ...prev, [member.id]: e.target.value }))
                        }
                        className="h-8 rounded-md border border-input bg-white px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="owner">owner</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="member-role-save"
                        onClick={() => handleSaveRole(member.id)}
                      >
                        Save
                      </Button>
                      {confirmingRemoveId === member.id ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          data-testid="member-remove-confirm"
                          onClick={() => handleRemove(member.id)}
                        >
                          Confirm
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="destructive"
                          data-testid="member-remove-button"
                          onClick={() => setConfirmingRemoveId(member.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invite a member</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="invite-email-input">Email</Label>
              <Input
                id="invite-email-input"
                data-testid="invite-email-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role-select">Role</Label>
              <select
                id="invite-role-select"
                data-testid="invite-role-select"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "member" | "viewer")}
                className="h-9 rounded-md border border-input bg-white px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <Button type="submit" data-testid="invite-submit" disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send invite"}
            </Button>
          </form>
          {error && (
            <p data-testid="invite-error" className="mt-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-slate-500">No pending invites.</p>
          ) : (
            <ul data-testid="pending-invites-list" className="divide-y divide-slate-100">
              {invites.map((invite) => (
                <li key={invite.id} data-testid="pending-invite-row" className="py-3 text-sm">
                  <span data-testid="pending-invite-email" className="text-slate-900">
                    {invite.email}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">({invite.role})</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
