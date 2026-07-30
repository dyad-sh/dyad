"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { isRole, type Role } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [meRes, usersRes] = await Promise.all([
          fetch("/api/me"),
          fetch("/api/admin/users"),
        ]);
        if (!meRes.ok || !usersRes.ok) {
          if (meRes.status === 403 || usersRes.status === 403) {
            window.location.href = "/account-deactivated";
            return;
          }
          throw new Error("Failed to load users");
        }
        const me = (await meRes.json()) as { id: string };
        const data = (await usersRes.json()) as UserRow[];
        if (!cancelled) {
          setMeId(me.id);
          setUsers(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load users");
          setUsers([]);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function patchUser(userId: string, payload: { role?: Role; active?: boolean }) {
    setPendingId(userId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | (UserRow & { error?: string })
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          data && "error" in data && data.error
            ? data.error
            : "Failed to update user",
        );
      }
      setUsers((prev) =>
        (prev ?? []).map((user) =>
          user.id === userId ? (data as UserRow) : user,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Users
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage roles and activation. Deactivation takes effect immediately.
        </p>
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Directory</CardTitle>
          <CardDescription>
            Role and activation changes are written to the audit trail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {users === null ? (
            <p className="text-sm text-slate-500">Loading users...</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table data-testid="users-table" className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((user) => {
                    const isSelf = meId === user.id;
                    return (
                      <tr
                        key={user.id}
                        data-testid="user-row"
                        data-user-id={user.id}
                      >
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {user.name || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{user.email}</td>
                        <td className="px-4 py-3">
                          <select
                            data-testid="user-role-select"
                            value={user.role}
                            disabled={pendingId === user.id}
                            onChange={(event) => {
                              const next = event.target.value;
                              if (isRole(next)) {
                                void patchUser(user.id, { role: next });
                              }
                            }}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm capitalize"
                          >
                            <option value="admin">admin</option>
                            <option value="agent">agent</option>
                            <option value="requester">requester</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            data-testid="user-status"
                            className={
                              user.active
                                ? "text-emerald-700"
                                : "text-rose-700"
                            }
                          >
                            {user.active ? "active" : "deactivated"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            type="button"
                            size="sm"
                            variant={user.active ? "outline" : "secondary"}
                            data-testid="user-deactivate"
                            disabled={pendingId === user.id || isSelf}
                            onClick={() =>
                              void patchUser(user.id, { active: !user.active })
                            }
                          >
                            {user.active ? "Deactivate" : "Reactivate"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
