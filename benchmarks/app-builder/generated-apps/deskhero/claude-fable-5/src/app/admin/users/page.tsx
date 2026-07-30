"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROLES, type Role } from "@/lib/tickets";

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

  useEffect(() => {
    fetch("/api/admin/users")
      .then((res) => (res.ok ? res.json() : []))
      .then(setUsers)
      .catch(() => setUsers([]));
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => setMeId(me?.id ?? null));
  }, []);

  const patchUser = async (
    userId: string,
    payload: { role?: Role; active?: boolean },
  ) => {
    setError(null);
    const previous = users;
    setUsers(
      (curr) =>
        curr?.map((u) => (u.id === userId ? { ...u, ...payload } : u)) ?? curr,
    );
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setUsers(previous);
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not update user.");
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Users
        </h1>
        <p className="text-sm text-slate-500">
          Manage roles and account access for everyone in the workspace
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {users === null ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <Table data-testid="users-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-40">Role</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-36">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow
                  key={user.id}
                  data-testid="user-row"
                  data-user-id={user.id}
                >
                  <TableCell className="font-medium text-slate-900">
                    {user.name}
                  </TableCell>
                  <TableCell className="text-slate-500">{user.email}</TableCell>
                  <TableCell>
                    <select
                      data-testid="user-role-select"
                      value={user.role}
                      disabled={user.id === meId}
                      onChange={(e) =>
                        patchUser(user.id, { role: e.target.value as Role })
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      data-testid="user-status"
                      className={
                        user.active
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                          : "bg-red-100 text-red-700 hover:bg-red-100"
                      }
                    >
                      {user.active ? "Active" : "Deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="user-deactivate"
                      disabled={user.id === meId}
                      onClick={() =>
                        patchUser(user.id, { active: !user.active })
                      }
                      className={
                        user.active
                          ? "text-red-600 hover:bg-red-50 hover:text-red-700"
                          : ""
                      }
                    >
                      {user.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
