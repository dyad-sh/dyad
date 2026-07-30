"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AppUser } from "@/types/ticket";

const ROLES: AppUser["role"][] = ["admin", "agent", "requester"];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [me, setMe] = useState<{ id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setUsers(data));
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe);
  }, []);

  async function patchUser(userId: string, payload: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to update user.");
      return;
    }
    const updated = await res.json();
    setUsers(
      (prev) => prev?.map((u) => (u.id === updated.id ? updated : u)) ?? prev,
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Users</h1>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {users === null ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table data-testid="users-table" className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  data-testid="user-row"
                  data-user-id={user.id}
                  className="border-t border-slate-100"
                >
                  <td className="px-4 py-3 text-slate-900">{user.name}</td>
                  <td className="px-4 py-3 text-slate-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) =>
                        patchUser(user.id, { role: e.target.value })
                      }
                      data-testid="user-role-select"
                      className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
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
                      className={
                        user.active ? "text-green-700" : "text-red-600"
                      }
                    >
                      {user.active ? "Active" : "Deactivated"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={user.id === me?.id}
                      onClick={() =>
                        patchUser(user.id, { active: !user.active })
                      }
                      data-testid="user-deactivate"
                    >
                      {user.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
