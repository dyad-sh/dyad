"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient, useAuthSession } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogOut, Users, Building2, KanbanSquare, Mail } from "lucide-react";
import type { Me } from "@/lib/types";

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useAuthSession();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe);
  }, []);

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  };

  const handleWorkspaceChange = async (workspaceId: string) => {
    await fetch("/api/workspaces/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    window.location.reload();
  };

  const activeMembership = me?.memberships.find(
    (m) => m.workspaceId === me.activeWorkspaceId,
  );
  const isOwner = activeMembership?.role === "owner";

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <span className="text-lg font-semibold tracking-tight text-slate-900">
            Relay CRM
          </span>
          <nav className="flex items-center gap-1">
            <Link
              href="/contacts"
              data-testid="nav-contacts"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                pathname?.startsWith("/contacts")
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <Users className="h-4 w-4" />
              Contacts
            </Link>
            <Link
              href="/companies"
              data-testid="nav-companies"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                pathname?.startsWith("/companies")
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <Building2 className="h-4 w-4" />
              Companies
            </Link>
            <Link
              href="/deals"
              data-testid="nav-deals"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                pathname?.startsWith("/deals")
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <KanbanSquare className="h-4 w-4" />
              Deals
            </Link>
            {isOwner && (
              <Link
                href="/settings/members"
                data-testid="nav-members"
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname?.startsWith("/settings/members")
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                <Users className="h-4 w-4" />
                Members
              </Link>
            )}
            <Link
              href="/invites"
              data-testid="nav-invites"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                pathname?.startsWith("/invites")
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <Mail className="h-4 w-4" />
              Invites
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {me && (
            <div className="flex items-center gap-2">
              <span data-testid="workspace-current-name" className="text-sm font-medium text-slate-700">
                {activeMembership?.workspaceName ?? ""}
              </span>
              <select
                data-testid="workspace-switcher"
                value={me.activeWorkspaceId ?? ""}
                onChange={(e) => handleWorkspaceChange(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {me.memberships.map((m) => (
                  <option key={m.workspaceId} value={m.workspaceId} data-testid="workspace-switcher-option">
                    {m.workspaceName}
                  </option>
                ))}
              </select>
              <Button asChild variant="ghost" size="sm">
                <Link href="/workspaces">Manage</Link>
              </Button>
            </div>
          )}
          <span data-testid="user-menu" className="text-sm text-slate-600">
            {session?.user?.email}
          </span>
          <Button variant="outline" size="sm" data-testid="sign-out-button" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
