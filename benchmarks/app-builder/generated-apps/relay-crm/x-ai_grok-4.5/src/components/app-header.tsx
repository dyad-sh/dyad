"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient, useAuthSession } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Membership } from "@/lib/types";

type MeResponse = {
  id: string;
  email: string;
  name: string;
  activeWorkspaceId: string;
  memberships: Membership[];
};

export function AppHeader() {
  const { data: session, isPending } = useAuthSession();
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [switching, setSwitching] = useState(false);

  const loadMe = async () => {
    try {
      const response = await fetch("/api/me");
      if (!response.ok) {
        setMe(null);
        return;
      }
      const data = (await response.json()) as MeResponse;
      setMe(data);
    } catch {
      setMe(null);
    }
  };

  useEffect(() => {
    if (session?.user) {
      void loadMe();
    } else {
      setMe(null);
    }

    const onWorkspaceChanged = () => {
      if (session?.user) {
        void loadMe();
      }
    };
    window.addEventListener("workspace-changed", onWorkspaceChanged);
    return () => {
      window.removeEventListener("workspace-changed", onWorkspaceChanged);
    };
  }, [session?.user?.id, pathname]);

  if (isPending || !session?.user) {
    return null;
  }

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      router.push("/auth/sign-in");
      router.refresh();
    } catch {
      router.push("/auth/sign-in");
    }
  };

  const handleSwitchWorkspace = async (workspaceId: string) => {
    if (!me || workspaceId === me.activeWorkspaceId || switching) return;
    setSwitching(true);
    try {
      const response = await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (response.ok) {
        await loadMe();
        window.dispatchEvent(new Event("workspace-changed"));
        router.refresh();
      }
    } finally {
      setSwitching(false);
    }
  };

  const navLinkClass = (href: string) =>
    cn(
      "text-sm font-medium transition-colors hover:text-slate-900",
      pathname.startsWith(href) ? "text-slate-900" : "text-slate-500",
    );

  const currentMembership =
    me?.memberships.find((m) => m.workspaceId === me.activeWorkspaceId) ??
    me?.memberships[0];
  const isCurrentOwner = currentMembership?.role === "owner";

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <Link
            href="/contacts"
            className="shrink-0 text-sm font-semibold tracking-tight text-slate-900"
          >
            Relay CRM
          </Link>
          <nav className="flex items-center gap-3 overflow-x-auto sm:gap-4">
            <Link
              href="/contacts"
              data-testid="nav-contacts"
              className={navLinkClass("/contacts")}
            >
              Contacts
            </Link>
            <Link
              href="/companies"
              data-testid="nav-companies"
              className={navLinkClass("/companies")}
            >
              Companies
            </Link>
            <Link
              href="/deals"
              data-testid="nav-deals"
              className={navLinkClass("/deals")}
            >
              Deals
            </Link>
            {isCurrentOwner ? (
              <Link
                href="/settings/members"
                data-testid="nav-members"
                className={navLinkClass("/settings/members")}
              >
                Members
              </Link>
            ) : null}
            <Link
              href="/workspaces"
              className={navLinkClass("/workspaces")}
            >
              Workspaces
            </Link>
            <Link href="/invites" className={navLinkClass("/invites")}>
              Invites
            </Link>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {me && currentMembership ? (
            <div className="flex items-center gap-2">
              <span
                data-testid="workspace-current-name"
                className="hidden max-w-[140px] truncate text-sm text-slate-600 md:inline"
              >
                {currentMembership.workspaceName}
              </span>
              <select
                data-testid="workspace-switcher"
                aria-label="Switch workspace"
                className="h-8 max-w-[160px] rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={me.activeWorkspaceId}
                disabled={switching}
                onChange={(e) => void handleSwitchWorkspace(e.target.value)}
              >
                {me.memberships.map((membership) => (
                  <option
                    key={membership.workspaceId}
                    value={membership.workspaceId}
                    data-testid="workspace-switcher-option"
                  >
                    {membership.workspaceName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <span
            data-testid="user-menu"
            className="max-w-[180px] truncate text-sm text-slate-600"
          >
            {session.user.email}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="sign-out-button"
            onClick={handleSignOut}
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
