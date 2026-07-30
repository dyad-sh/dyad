'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import type { CurrentUser, Role } from "@/lib/auth/current-user";
import type { DeskheroUser } from "@/lib/tickets";

export default function UsersPage() {
  const [users, setUsers] = useState<DeskheroUser[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");

  useEffect(() => { Promise.all([fetch("/api/admin/users"), fetch("/api/me")]).then(async ([usersResponse, meResponse]) => { const usersData = await usersResponse.json(); const meData = await meResponse.json(); if (!usersResponse.ok) throw new Error(usersData.error ?? "Unable to load users"); setUsers(usersData); setMe(meData); }).catch((reason: Error) => setError(reason.message)); }, []);

  async function updateUser(id: string, change: { role?: Role; active?: boolean }) {
    setSaving(id); setError("");
    const response = await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
    const data = await response.json();
    if (response.ok) setUsers((current) => current.map((user) => user.id === id ? data : user)); else setError(data.error ?? "Unable to update user");
    setSaving("");
  }

  return <div><Link href="/admin" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" /> Back to dashboard</Link><div className="mb-8"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Administration</p><h1 className="text-3xl font-bold tracking-tight text-slate-950">Users</h1><p className="mt-2 text-sm text-slate-500">Manage roles and account access. Your own account is locked.</p></div>{error && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    <div data-testid="users-table" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="hidden grid-cols-[1fr_1.3fr_150px_120px_120px] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 lg:grid"><span>Name</span><span>Email</span><span>Role</span><span>Status</span><span>Action</span></div>{users.map((user) => <div key={user.id} data-testid="user-row" data-user-id={user.id} className={`grid gap-3 border-b border-slate-100 px-5 py-4 last:border-b-0 lg:grid-cols-[1fr_1.3fr_150px_120px_120px] lg:items-center lg:px-6 ${user.active ? "" : "bg-slate-50/70"}`}><span className="font-medium text-slate-900">{user.name}</span><span className="truncate text-sm text-slate-500">{user.email}</span><select data-testid="user-role-select" value={user.role} disabled={saving === user.id || me?.id === user.id || !user.active} onChange={(event) => updateUser(user.id, { role: event.target.value as Role })} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium capitalize outline-none focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400"><option value="admin">Admin</option><option value="agent">Agent</option><option value="requester">Requester</option></select><span data-testid="user-status" className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${user.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{user.active ? "Active" : "Deactivated"}</span><button data-testid="user-deactivate" disabled={saving === user.id || me?.id === user.id} onClick={() => updateUser(user.id, { active: !user.active })} className={`h-9 rounded-lg px-3 text-sm font-semibold disabled:opacity-40 ${user.active ? "text-red-600 hover:bg-red-50" : "text-emerald-700 hover:bg-emerald-50"}`}>{user.active ? "Deactivate" : "Reactivate"}</button></div>)}</div>
  </div>;
}
