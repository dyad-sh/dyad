"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type OrgRole = "org_admin" | "org_member";
type InviteStatus = "pending" | "accepted" | "revoked";

interface Member {
  user_id: string;
  role: OrgRole;
  email: string;
  name: string;
}

interface Invite {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  status: InviteStatus;
}

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";

function MemberRow({
  orgId,
  member,
  currentUserId,
  isAdmin,
  onChanged,
}: {
  orgId: string;
  member: Member;
  currentUserId: string;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [role, setRole] = useState(member.role);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRoleChange(nextRole: OrgRole) {
    setRole(nextRole);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${member.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not update role.");
      }
      onChanged();
    } catch (err) {
      setRole(member.role);
      setError(err instanceof Error ? err.message : "Could not update role.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${member.user_id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not remove member.");
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove member.");
      setBusy(false);
      setConfirmingRemove(false);
    }
  }

  return (
    <TableRow data-testid="member-row" data-member-email={member.email} data-user-id={member.user_id}>
      <TableCell data-testid="member-email">{member.email}</TableCell>
      <TableCell>{member.name}</TableCell>
      <TableCell data-testid="member-role">
        {isAdmin ? (
          <select
            className={selectClassName}
            value={role}
            disabled={busy}
            onChange={(e) => handleRoleChange(e.target.value as OrgRole)}
            data-testid="member-role-select"
          >
            <option value="org_admin">Admin</option>
            <option value="org_member">Member</option>
          </select>
        ) : (
          <Badge variant={member.role === "org_admin" ? "default" : "secondary"}>
            {member.role === "org_admin" ? "Admin" : "Member"}
          </Badge>
        )}
      </TableCell>
      {isAdmin && (
        <TableCell>
          {confirmingRemove ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={handleRemove}
                data-testid="member-remove-confirm"
              >
                Confirm
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmingRemove(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={member.user_id === currentUserId}
              onClick={() => setConfirmingRemove(true)}
              data-testid="member-remove"
            >
              Remove
            </Button>
          )}
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </TableCell>
      )}
    </TableRow>
  );
}

function InviteForm({ orgId, onCreated }: { orgId: string; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("org_member");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Could not send invite.");
      }
      setEmail("");
      setRole("org_member");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send invite.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          required
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="invite-email-input"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          className={selectClassName}
          value={role}
          onChange={(e) => setRole(e.target.value as OrgRole)}
          data-testid="invite-role-select"
        >
          <option value="org_admin">Admin</option>
          <option value="org_member">Member</option>
        </select>
      </div>

      <Button type="submit" disabled={submitting} data-testid="invite-submit">
        {submitting ? "Sending..." : "Send invite"}
      </Button>

      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}

function InvitesTable({
  orgId,
  invites,
  origin,
  onChanged,
}: {
  orgId: string;
  invites: Invite[];
  origin: string;
  onChanged: () => void;
}) {
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleRevoke(inviteId: string) {
    setRevokingId(inviteId);
    try {
      const res = await fetch(`/api/orgs/${orgId}/invites/${inviteId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onChanged();
      }
    } finally {
      setRevokingId(null);
    }
  }

  if (invites.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No invites have been sent yet.</p>
    );
  }

  return (
    <Table data-testid="invites-table">
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Link</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {invites.map((invite) => (
          <TableRow key={invite.id} data-testid="invite-row" data-invite-email={invite.email}>
            <TableCell>{invite.email}</TableCell>
            <TableCell>{invite.role === "org_admin" ? "Admin" : "Member"}</TableCell>
            <TableCell data-testid="invite-status">{invite.status}</TableCell>
            <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
              {invite.status === "pending" ? (
                <span data-testid="invite-link">{`${origin}/invite/${invite.token}`}</span>
              ) : (
                <span data-testid="invite-link" />
              )}
            </TableCell>
            <TableCell>
              {invite.status === "pending" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={revokingId === invite.id}
                  onClick={() => handleRevoke(invite.id)}
                  data-testid="invite-revoke"
                >
                  Revoke
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MembersPanel({
  orgId,
  members,
  invites,
  currentUserId,
  isAdmin,
  origin,
}: {
  orgId: string;
  members: Member[];
  invites: Invite[];
  currentUserId: string;
  isAdmin: boolean;
  origin: string;
}) {
  const router = useRouter();

  function handleChanged() {
    router.refresh();
  }

  return (
    <div className="space-y-10">
      <div>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Members</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              People with access to this organization.
            </p>
          </div>
          <div
            data-testid="member-count"
            className="rounded-full bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground"
          >
            {members.length} {members.length === 1 ? "member" : "members"}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-sm">
          <Table data-testid="members-table">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                {isAdmin && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <MemberRow
                  key={member.user_id}
                  orgId={orgId}
                  member={member}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  onChanged={handleChanged}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {isAdmin && (
        <div>
          <h2 className="text-lg font-semibold text-foreground">Invites</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite teammates by email and manage pending invitations.
          </p>

          <div className="mt-4 rounded-xl border border-border bg-card p-6 shadow-sm">
            <InviteForm orgId={orgId} onCreated={handleChanged} />
          </div>

          <div className="mt-6 rounded-xl border border-border bg-card shadow-sm">
            <InvitesTable
              orgId={orgId}
              invites={invites}
              origin={origin}
              onChanged={handleChanged}
            />
          </div>
        </div>
      )}
    </div>
  );
}
