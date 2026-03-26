import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  subscription?: { plan: string; status: string };
}

interface Stats {
  totalUsers: number;
  proUsers: number;
  freeUsers: number;
  totalApps: number;
  totalMessages: number;
}

async function apiFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
  const json = await res.json();
  return json;
}

function AdminPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    const [usersRes, statsRes] = await Promise.all([
      apiFetch("/admin/users", token),
      apiFetch("/admin/stats", token),
    ]);
    if (usersRes.ok) setUsers(usersRes.data);
    if (statsRes.ok) setStats(statsRes.data);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [token]);

  const handleSetPlan = async (userId: string, plan: "free" | "pro") => {
    if (!token) return;
    const res = await apiFetch(`/admin/users/${userId}/set-plan`, token, {
      method: "POST",
      body: JSON.stringify({ plan }),
    });
    if (res.ok) {
      setMessage(`Plan updated to ${plan}`);
      loadData();
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`Delete user ${email}? This is irreversible.`)) return;
    if (!token) return;
    const res = await apiFetch(`/admin/users/${userId}`, token, { method: "DELETE" });
    if (res.ok) {
      setMessage("User deleted");
      loadData();
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>

      {message && (
        <div className="rounded border border-border bg-muted px-4 py-3 text-sm">
          {message}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            { label: "Total users", value: stats.totalUsers },
            { label: "Pro users", value: stats.proUsers },
            { label: "Free users", value: stats.freeUsers },
            { label: "Total apps", value: stats.totalApps },
            { label: "Total messages", value: stats.totalMessages },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-border p-4 text-center">
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Users table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No users yet
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={u.subscription?.plan === "pro" ? "default" : "secondary"}>
                      {u.subscription?.plan ?? "free"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {u.subscription?.status ?? "active"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 space-x-2">
                    {u.subscription?.plan !== "pro" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSetPlan(u.id, "pro")}
                      >
                        Grant Pro
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSetPlan(u.id, "free")}
                      >
                        Revoke Pro
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeleteUser(u.id, u.email)}
                    >
                      Delete
                    </Button>
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

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: () => (
    <AuthGuard requireAdmin>
      <AdminPage />
    </AuthGuard>
  ),
});
