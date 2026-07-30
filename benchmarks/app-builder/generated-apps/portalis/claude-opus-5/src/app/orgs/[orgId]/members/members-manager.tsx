"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Invite, Member } from "@/lib/orgs";

const ROLE_LABEL: Record<string, string> = {
  org_admin: "Admin",
  org_member: "Member",
};

export function MembersManager({
  orgId,
  orgName,
  viewerRole,
  viewerId,
  members,
  invites,
  origin,
}: {
  orgId: string;
  orgName: string;
  viewerRole: string;
  viewerId: string;
  members: Member[];
  invites: Invite[];
  origin: string;
}) {
  const router = useRouter();
  const isAdmin = viewerRole === "org_admin";

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("org_member");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitePending, setInvitePending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInvitePending(true);
    const res = await fetch(`/api/orgs/${orgId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    setInvitePending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setInviteError(body.error ?? "Could not send the invite.");
      return;
    }
    setInviteEmail("");
    router.refresh();
  }

  async function revokeInvite(inviteId: string) {
    setActionError(null);
    const res = await fetch(`/api/orgs/${orgId}/invites/${inviteId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setActionError(body.error ?? "Could not revoke the invite.");
      return;
    }
    router.refresh();
  }

  async function changeRole(userId: string, role: string) {
    setActionError(null);
    const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setActionError(body.error ?? "Could not change that role.");
      return;
    }
    router.refresh();
  }

  async function removeMember(userId: string) {
    setActionError(null);
    const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setActionError(body.error ?? "Could not remove that member.");
      return;
    }
    setConfirming(null);
    if (userId === viewerId) {
      router.replace("/orgs");
      router.refresh();
      return;
    }
    router.refresh();
  }

  const pendingInvites = invites.filter((i) => i.status !== "accepted");

  return (
    <div className="space-y-8">
      {isAdmin && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Invite someone
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Share the generated link with them — no email is sent from this
            environment.
          </p>
          <form
            onSubmit={submitInvite}
            className="mt-5 flex flex-wrap items-end gap-3"
            noValidate
          >
            <div className="min-w-[16rem] flex-1 space-y-1.5">
              <label
                htmlFor="invite-email"
                className="block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="invite-email"
                data-testid="invite-email-input"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="invite-role"
                className="block text-sm font-medium text-slate-700"
              >
                Role
              </label>
              <select
                id="invite-role"
                data-testid="invite-role-select"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="org_member">Member</option>
                <option value="org_admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              data-testid="invite-submit"
              disabled={invitePending}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {invitePending ? "Inviting…" : "Send invite"}
            </button>
          </form>
          {inviteError && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
            >
              {inviteError}
            </p>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Invites</h2>
            <p className="mt-1 text-sm text-slate-500">
              Pending and revoked invites for {orgName}.
            </p>
          </div>
          {pendingInvites.length === 0 ? (
            <p className="px-6 py-8 text-sm text-slate-500">
              No outstanding invites.
            </p>
          ) : (
            <table
              data-testid="invites-table"
              className="w-full text-left text-sm"
            >
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-6 py-3 font-medium">Email</th>
                  <th className="px-6 py-3 font-medium">Role</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Accept link</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((invite) => (
                  <tr
                    key={invite.id}
                    data-testid="invite-row"
                    data-invite-email={invite.email}
                    className="border-b border-slate-100 align-top last:border-0"
                  >
                    <td className="px-6 py-4 font-medium text-slate-900">
                      {invite.email}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {ROLE_LABEL[invite.role] ?? invite.role}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        data-testid="invite-status"
                        className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${
                          invite.status === "pending"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {invite.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        data-testid="invite-link"
                        className="block max-w-xs break-all font-mono text-xs text-slate-600"
                      >
                        {`${origin}/invite/${invite.token}`}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {invite.status === "pending" && (
                        <button
                          type="button"
                          data-testid="invite-revoke"
                          onClick={() => revokeInvite(invite.id)}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Members</h2>
            <p className="mt-1 text-sm text-slate-500">
              People with access to {orgName}.
            </p>
          </div>
          <span
            data-testid="member-count"
            className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700"
          >
            {members.length}
          </span>
        </div>

        {actionError && (
          <p
            role="alert"
            className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
          >
            {actionError}
          </p>
        )}

        <table data-testid="members-table" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-6 py-3 font-medium">Email</th>
              <th className="px-6 py-3 font-medium">Role</th>
              {isAdmin && <th className="px-6 py-3" />}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr
                key={member.user_id}
                data-testid="member-row"
                data-member-email={member.email}
                data-user-id={member.user_id}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="px-6 py-4">
                  <span
                    data-testid="member-email"
                    className="font-medium text-slate-900"
                  >
                    {member.email}
                  </span>
                  {member.name && (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {member.name}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span
                    data-testid="member-role"
                    className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
                  >
                    {member.role}
                  </span>
                  {isAdmin && (
                    <select
                      data-testid="member-role-select"
                      aria-label={`Role for ${member.email}`}
                      value={member.role}
                      onChange={(e) =>
                        changeRole(member.user_id, e.target.value)
                      }
                      className="ml-3 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 shadow-sm outline-none focus:border-indigo-500"
                    >
                      <option value="org_member">org_member</option>
                      <option value="org_admin">org_admin</option>
                    </select>
                  )}
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        data-testid="member-remove"
                        onClick={() =>
                          setConfirming(
                            confirming === member.user_id
                              ? null
                              : member.user_id,
                          )
                        }
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Remove
                      </button>
                      {confirming === member.user_id && (
                        <button
                          type="button"
                          data-testid="member-remove-confirm"
                          onClick={() => removeMember(member.user_id)}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
                        >
                          Confirm
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
