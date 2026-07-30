'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useMe } from '@/hooks/use-me';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Trash2 } from 'lucide-react';

type Member = { id: string; userId: string; email: string; role: string };
type Invite = { id: string; email: string; role?: string };

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function MembersPage() {
  const { me, loading: meLoading, isOwner } = useMe();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [memberError, setMemberError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const workspaceId = me?.activeWorkspaceId ?? null;

  const loadWorkspaceData = useCallback(async () => {
    if (!workspaceId) return;
    const [membersRes, invitesRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/members`),
      fetch(`/api/workspaces/${workspaceId}/invites`),
    ]);
    setMembers(membersRes.ok ? await membersRes.json() : []);
    setInvites(invitesRes.ok ? await invitesRes.json() : []);
  }, [workspaceId]);

  useEffect(() => {
    if (meLoading) return;
    if (!isOwner || !workspaceId) {
      setLoading(false);
      return;
    }
    loadWorkspaceData().finally(() => setLoading(false));
  }, [meLoading, isOwner, workspaceId, loadWorkspaceData]);

  const activeMembership = me?.memberships.find(
    (m) => m.workspaceId === me.activeWorkspaceId,
  );

  if (meLoading || loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  if (!isOwner) {
    return (
      <div
        data-testid="forbidden-message"
        className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-8 text-center"
      >
        <p className="font-semibold text-red-700">Access denied</p>
        <p className="mt-1 text-sm text-red-600">
          Only workspace owners can manage members and invites.
        </p>
      </div>
    );
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;
    setInviteError(null);
    setInviting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to send invite');
      }
      setInviteEmail('');
      await loadWorkspaceData();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  };

  const handleRoleSave = async (member: Member) => {
    if (!workspaceId) return;
    const draft = roleDrafts[member.id] ?? member.role;
    setMemberError(null);
    setBusyId(member.id);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/members/${member.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: draft }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to update role');
      }
      await loadWorkspaceData();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (member: Member) => {
    if (!workspaceId) return;
    setMemberError(null);
    setBusyId(member.id);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/members/${member.id}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to remove member');
      }
      await loadWorkspaceData();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Members</h1>
      <p className="mb-6 text-sm text-slate-500">
        People in {activeMembership?.workspaceName ?? 'this workspace'}
      </p>

      {memberError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {memberError}
        </p>
      )}

      <ul
        data-testid="members-list"
        className="mb-8 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white"
      >
        {members.map((member) => {
          const isSelf = member.userId === me?.id;
          return (
            <li
              key={member.id}
              data-testid="member-row"
              data-user-id={member.userId}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <span data-testid="member-row-email" className="flex-1 text-slate-900">
                {member.email}
              </span>
              <Badge
                data-testid="member-row-role"
                variant={member.role === 'owner' ? 'default' : 'secondary'}
                className={member.role === 'owner' ? 'bg-indigo-600' : ''}
              >
                {member.role}
              </Badge>
              {!isSelf && (
                <div className="flex items-center gap-2">
                  <select
                    data-testid="member-role-select"
                    className={selectClass}
                    value={roleDrafts[member.id] ?? member.role}
                    onChange={(e) =>
                      setRoleDrafts((d) => ({ ...d, [member.id]: e.target.value }))
                    }
                  >
                    <option value="owner">owner</option>
                    <option value="member">member</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="member-role-save"
                    disabled={busyId === member.id}
                    onClick={() => handleRoleSave(member)}
                  >
                    Save
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="destructive"
                        data-testid="member-remove-button"
                        disabled={busyId === member.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this member?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {member.email} will lose access to this workspace.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          data-testid="member-remove-confirm"
                          onClick={() => handleRemove(member)}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mb-8 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          Invite someone
        </h2>
        <form onSubmit={handleInvite} className="flex items-start gap-2">
          <div className="flex-1">
            <Input
              type="email"
              required
              data-testid="invite-email-input"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@example.com"
            />
          </div>
          <select
            data-testid="invite-role-select"
            className={`${selectClass} h-10`}
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          >
            <option value="member">member</option>
            <option value="viewer">viewer</option>
          </select>
          <Button
            type="submit"
            data-testid="invite-submit"
            disabled={inviting}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {inviting ? 'Inviting…' : 'Invite'}
          </Button>
        </form>
        {inviteError && (
          <p
            data-testid="invite-error"
            className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
          >
            {inviteError}
          </p>
        )}
      </div>

      <h2 className="mb-3 text-lg font-semibold text-slate-900">
        Pending invites
      </h2>
      {invites.length === 0 ? (
        <div
          data-testid="pending-invites-list"
          className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500"
        >
          No pending invites.
        </div>
      ) : (
        <ul
          data-testid="pending-invites-list"
          className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          {invites.map((invite) => (
            <li
              key={invite.id}
              data-testid="pending-invite-row"
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span data-testid="pending-invite-email" className="text-slate-900">
                {invite.email}
              </span>
              <div className="flex items-center gap-2">
                {invite.role && <Badge variant="secondary">{invite.role}</Badge>}
                <Badge variant="outline">pending</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
