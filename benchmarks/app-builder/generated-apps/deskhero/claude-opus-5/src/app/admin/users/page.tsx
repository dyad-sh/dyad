"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ROLES, type Role } from "@/lib/roles";
import { errorMessage } from "@/lib/error-message";

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  active: boolean;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [usersRes, meRes] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/me", { cache: "no-store" }),
      ]);
      if (usersRes.status === 401) {
        window.location.href = "/auth/sign-in";
        return;
      }
      if (!active) return;
      if (meRes.ok) {
        const me = (await meRes.json()) as { id: string };
        setMeId(me.id);
      }
      if (!usersRes.ok) {
        setError("Could not load users.");
        setUsers([]);
        return;
      }
      setUsers((await usersRes.json()) as UserRow[]);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function patchUser(id: string, changes: Partial<UserRow>) {
    setError(null);
    setSavingId(id);
    const previous = users;
    setUsers((current) =>
      (current ?? []).map((u) => (u.id === id ? { ...u, ...changes } : u)),
    );
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(errorMessage(payload, "Could not update the user."));
        setUsers(previous);
      }
    } catch (err) {
      setError(errorMessage(err, "Could not update the user."));
      setUsers(previous);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
        Users
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Role and activation changes take effect immediately.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table data-testid="users-table" className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {users === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  data-testid="user-row"
                  data-user-id={user.id}
                  className="align-middle"
                >
                  <td className="px-4 py-3 text-slate-900">
                    {user.name || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <select
                      data-testid="user-role-select"
                      aria-label={`Role for ${user.email}`}
                      value={user.role}
                      disabled={savingId === user.id}
                      onChange={(e) =>
                        patchUser(user.id, { role: e.target.value as Role })
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      data-testid="user-status"
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                        user.active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-red-200 bg-red-50 text-red-700"
                      }`}
                    >
                      {user.active ? "Active" : "Deactivated"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      data-testid="user-deactivate"
                      disabled={savingId === user.id || user.id === meId}
                      title={
                        user.id === meId
                          ? "You cannot deactivate your own account"
                          : undefined
                      }
                      onClick={() =>
                        patchUser(user.id, { active: !user.active })
                      }
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                    >
                      {user.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
