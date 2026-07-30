"use client";

import { FormEvent, useState } from "react";

type Invite = { id: string; email: string; role: string; token: string; status: string };

export function InvitePanel({ orgId, invites, origin }: { orgId: string; invites: Invite[]; origin: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/orgs/${orgId}/invites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), role: form.get("role") }) });
    if (!response.ok) setMessage((await response.json()).error ?? "Unable to create invite."); else window.location.reload();
    setBusy(false);
  }

  async function revoke(inviteId: string) {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/orgs/${orgId}/invites/${inviteId}`, { method: "DELETE" });
    if (!response.ok) setMessage((await response.json()).error ?? "Unable to revoke invite."); else window.location.reload();
    setBusy(false);
  }

  return <section className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div><h2 className="text-lg font-semibold">Invite people</h2><p className="mt-1 text-sm text-slate-500">Share the generated secure link with the person you invite.</p></div><form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]"><input data-testid="invite-email-input" name="email" type="email" required placeholder="person@company.com" className="rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-sky-500"/><select data-testid="invite-role-select" name="role" defaultValue="org_member" className="rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-sky-500"><option value="org_member">Org member</option><option value="org_admin">Org admin</option></select><button data-testid="invite-submit" disabled={busy} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">Invite</button></form>{message && <p className="text-sm text-red-700">{message}</p>}<div className="overflow-x-auto"><table data-testid="invites-table" className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-3 pr-4">Email</th><th className="py-3 pr-4">Role</th><th className="py-3 pr-4">Status</th><th className="py-3">Accept link</th></tr></thead><tbody>{invites.map((invite) => <tr key={invite.id} data-testid="invite-row" data-invite-email={invite.email} className="border-t border-slate-100"><td className="py-3 pr-4">{invite.email}</td><td className="py-3 pr-4">{invite.role}</td><td data-testid="invite-status" className="py-3 pr-4">{invite.status}</td><td className="py-3"><p data-testid="invite-link" className="break-all text-xs text-sky-700">{origin}/invite/{invite.token}</p><button data-testid="invite-revoke" onClick={() => revoke(invite.id)} disabled={busy} className="mt-2 text-xs font-medium text-red-700 hover:text-red-900">Revoke</button></td></tr>)}</tbody></table></div></section>;
}
