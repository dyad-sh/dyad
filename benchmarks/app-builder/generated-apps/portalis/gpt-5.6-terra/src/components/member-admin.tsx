"use client";

import { useState } from "react";

type Member = { user_id: string; email: string; role: "org_admin" | "org_member" };

export function MemberAdmin({ orgId, members }: { orgId: string; members: Member[] }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function changeRole(userId: string, role: string) {
    setError("");
    const response = await fetch(`/api/orgs/${orgId}/members/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    if (!response.ok) setError((await response.json()).error ?? "Unable to update role."); else window.location.reload();
  }

  async function remove(userId: string) {
    setError("");
    const response = await fetch(`/api/orgs/${orgId}/members/${userId}`, { method: "DELETE" });
    if (!response.ok) setError((await response.json()).error ?? "Unable to remove member."); else window.location.assign("/orgs");
  }

  return <>{error && <p className="px-6 pt-4 text-sm text-red-700">{error}</p>}<tbody>{members.map((member) => <tr key={member.user_id} data-testid="member-row" data-member-email={member.email} data-user-id={member.user_id} className="border-t border-slate-100"><td data-testid="member-email" className="px-6 py-4 text-slate-700">{member.email}</td><td data-testid="member-role" className="px-6 py-4"><select data-testid="member-role-select" value={member.role} onChange={(event) => changeRole(member.user_id, event.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"><option value="org_admin">org_admin</option><option value="org_member">org_member</option></select></td><td className="px-6 py-4 text-right">{removing === member.user_id ? <button data-testid="member-remove-confirm" onClick={() => remove(member.user_id)} className="text-xs font-medium text-red-700">Confirm remove</button> : <button data-testid="member-remove" onClick={() => setRemoving(member.user_id)} className="text-xs font-medium text-red-700">Remove</button>}</td></tr>)}</tbody></>;
}
