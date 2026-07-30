"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { OrganizationInvite, OrganizationMember, OrganizationRole } from "@/lib/organizations";

export function MemberManagement({ orgId, members, invites, origin }: { orgId: string; members: OrganizationMember[]; invites: OrganizationInvite[]; origin: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("org_member");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmUser, setConfirmUser] = useState("");

  async function invite(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch(`/api/orgs/${orgId}/invites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error ?? "Unable to invite this person."); return; }
    setEmail(""); router.refresh();
  }

  async function updateRole(userId: string, nextRole: OrganizationRole) {
    const response = await fetch(`/api/orgs/${orgId}/members/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: nextRole }) });
    if (!response.ok) { const data = await response.json(); setError(data.error ?? "Unable to update the role."); return; }
    router.refresh();
  }

  async function removeMember(userId: string) {
    const response = await fetch(`/api/orgs/${orgId}/members/${userId}`, { method: "DELETE" });
    if (!response.ok) { const data = await response.json(); setError(data.error ?? "Unable to remove this member."); return; }
    setConfirmUser(""); router.refresh();
  }

  async function revokeInvite(inviteId: string) {
    const response = await fetch(`/api/orgs/${orgId}/invites/${inviteId}`, { method: "DELETE" });
    if (!response.ok) { const data = await response.json(); setError(data.error ?? "Unable to revoke this invite."); return; }
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="mb-5"><h2 className="font-semibold text-slate-950">Invite a member</h2><p className="mt-1 text-sm text-slate-500">Create a secure invite link for a teammate.</p></div>
        <form className="grid gap-4 sm:grid-cols-[1fr_180px_auto] sm:items-end" onSubmit={invite}>
          <div className="space-y-2"><Label htmlFor="invite-email">Email</Label><Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required data-testid="invite-email-input" /></div>
          <div className="space-y-2"><Label htmlFor="invite-role">Role</Label><select id="invite-role" className="h-9 w-full rounded-md border bg-white px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value as OrganizationRole)} data-testid="invite-role-select"><option value="org_member">Org member</option><option value="org_admin">Org admin</option></select></div>
          <Button type="submit" disabled={busy} className="bg-sky-600 hover:bg-sky-700" data-testid="invite-submit">{busy ? <Loader2 className="animate-spin" /> : <UserPlus />}Invite</Button>
        </form>
        {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold text-slate-950">Members</h2><span className="text-sm text-slate-500" data-testid="member-count">{members.length} {members.length === 1 ? "member" : "members"}</span></div>
        <Table data-testid="members-table"><TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{members.map((member) => (
          <TableRow key={member.user_id} data-testid="member-row" data-member-email={member.email} data-user-id={member.user_id}>
            <TableCell className="font-medium" data-testid="member-email">{member.email}</TableCell>
            <TableCell data-testid="member-role"><select className="h-8 rounded-md border bg-white px-2 text-sm" value={member.role} onChange={(event) => updateRole(member.user_id, event.target.value as OrganizationRole)} data-testid="member-role-select"><option value="org_member">Org member</option><option value="org_admin">Org admin</option></select></TableCell>
            <TableCell className="text-right">{confirmUser === member.user_id ? <Button size="sm" variant="destructive" onClick={() => removeMember(member.user_id)} data-testid="member-remove-confirm">Confirm remove</Button> : <Button size="sm" variant="ghost" onClick={() => setConfirmUser(member.user_id)} data-testid="member-remove"><Trash2 />Remove</Button>}</TableCell>
          </TableRow>
        ))}</TableBody></Table>
      </section>

      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-950">Invites</h2>
        <Table data-testid="invites-table"><TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Accept URL</TableHead><TableHead /></TableRow></TableHeader><TableBody>{invites.map((invite) => (
          <TableRow key={invite.id} data-testid="invite-row" data-invite-email={invite.email}><TableCell>{invite.email}</TableCell><TableCell>{invite.role}</TableCell><TableCell data-testid="invite-status">{invite.status}</TableCell><TableCell className="max-w-xs break-all text-xs text-sky-700" data-testid="invite-link">{origin}/invite/{invite.token}</TableCell><TableCell className="text-right">{invite.status === "pending" && <Button size="sm" variant="ghost" onClick={() => revokeInvite(invite.id)} data-testid="invite-revoke">Revoke</Button>}</TableCell></TableRow>
        ))}</TableBody></Table>
      </section>
    </div>
  );
}
