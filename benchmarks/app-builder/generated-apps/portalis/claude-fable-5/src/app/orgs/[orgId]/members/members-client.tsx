"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type Member = {
  userId: string;
  email: string;
  name: string;
  role: string;
};

export type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
};

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

export function MembersClient({
  orgId,
  members,
  invites,
  origin,
  isAdmin,
}: {
  orgId: string;
  members: Member[];
  invites: Invite[];
  origin: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("org_member");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(
    null,
  );

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setInviting(true);
    const res = await fetch(`/api/orgs/${orgId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    setInviting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setInviteError(body?.error ?? "Could not send the invite.");
      return;
    }
    setInviteEmail("");
    router.refresh();
  };

  const revokeInvite = async (inviteId: string) => {
    await fetch(`/api/orgs/${orgId}/invites/${inviteId}`, {
      method: "DELETE",
    });
    router.refresh();
  };

  const changeRole = async (userId: string, role: string) => {
    setMemberError(null);
    const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setMemberError(body?.error ?? "Could not change the role.");
    }
    router.refresh();
  };

  const removeMember = async (userId: string) => {
    setMemberError(null);
    const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
      method: "DELETE",
    });
    setConfirmingRemove(null);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setMemberError(body?.error ?? "Could not remove the member.");
    }
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Members</h2>
        <Badge variant="secondary" data-testid="member-count">
          {members.length} {members.length === 1 ? "member" : "members"}
        </Badge>
      </div>

      {memberError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {memberError}
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table data-testid="members-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                {isAdmin && <TableHead className="w-40">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow
                  key={member.userId}
                  data-testid="member-row"
                  data-member-email={member.email}
                  data-user-id={member.userId}
                >
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell data-testid="member-email">
                    {member.email}
                  </TableCell>
                  <TableCell data-testid="member-role">
                    {isAdmin ? (
                      <select
                        data-testid="member-role-select"
                        className={selectClass}
                        value={member.role}
                        onChange={(e) =>
                          changeRole(member.userId, e.target.value)
                        }
                      >
                        <option value="org_admin">org_admin</option>
                        <option value="org_member">org_member</option>
                      </select>
                    ) : (
                      <Badge variant="outline">{member.role}</Badge>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      {confirmingRemove === member.userId ? (
                        <span className="flex items-center gap-2">
                          <Button
                            data-testid="member-remove-confirm"
                            variant="destructive"
                            size="sm"
                            onClick={() => removeMember(member.userId)}
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmingRemove(null)}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button
                          data-testid="member-remove"
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmingRemove(member.userId)}
                        >
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isAdmin && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invite a member</CardTitle>
              <CardDescription>
                Share the generated link with them — no email is sent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={sendInvite}
                className="flex flex-wrap items-end gap-3"
              >
                <div className="min-w-56 flex-1 space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    data-testid="invite-email-input"
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-role">Role</Label>
                  <br />
                  <select
                    id="invite-role"
                    data-testid="invite-role-select"
                    className={selectClass}
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                  >
                    <option value="org_member">org_member</option>
                    <option value="org_admin">org_admin</option>
                  </select>
                </div>
                <Button
                  type="submit"
                  data-testid="invite-submit"
                  disabled={inviting}
                >
                  {inviting ? "Inviting…" : "Send invite"}
                </Button>
              </form>
              {inviteError && (
                <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {inviteError}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invites</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {invites.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">
                  No invites yet.
                </p>
              ) : (
                <Table data-testid="invites-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Invite link</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((invite) => (
                      <TableRow
                        key={invite.id}
                        data-testid="invite-row"
                        data-invite-email={invite.email}
                      >
                        <TableCell className="font-medium">
                          {invite.email}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{invite.role}</Badge>
                        </TableCell>
                        <TableCell data-testid="invite-status">
                          {invite.status}
                        </TableCell>
                        <TableCell className="max-w-72">
                          {invite.status === "pending" ? (
                            <code
                              data-testid="invite-link"
                              className="block truncate rounded bg-muted px-2 py-1 text-xs"
                            >
                              {`${origin}/invite/${invite.token}`}
                            </code>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {invite.status === "pending" && (
                            <Button
                              data-testid="invite-revoke"
                              variant="outline"
                              size="sm"
                              onClick={() => revokeInvite(invite.id)}
                            >
                              Revoke
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
