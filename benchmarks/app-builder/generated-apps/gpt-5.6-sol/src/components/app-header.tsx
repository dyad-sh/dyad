'use client';

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, BriefcaseBusiness, LogOut, Settings, Users } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Membership } from "@/lib/workspace";

export function AppHeader({ email, memberships, activeWorkspaceId }: { email: string; memberships: Membership[]; activeWorkspaceId: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = async () => {
    await authClient.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  };

  const switchWorkspace = async (workspaceId: string) => {
    const response = await fetch("/api/workspaces/active", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId }) });
    if (response.ok) { router.push("/contacts"); router.refresh(); }
  };

  const navClass = (active: boolean) => cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950");
  const current = memberships.find((membership) => membership.workspaceId === activeWorkspaceId)!;

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-5 py-3 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-5">
            <Link href="/contacts" className="flex items-center gap-3 font-semibold tracking-tight text-slate-950"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">R</span>Relay CRM</Link>
            <div className="flex items-center gap-2">
              <span className="max-w-40 truncate text-sm font-medium text-slate-600" data-testid="workspace-current-name">{current.workspaceName}</span>
              <select className="h-9 max-w-52 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" aria-label="Switch workspace" value={activeWorkspaceId} onChange={(event) => switchWorkspace(event.target.value)} data-testid="workspace-switcher">
                {memberships.map((membership) => <option key={membership.workspaceId} value={membership.workspaceId} data-testid="workspace-switcher-option">{membership.workspaceName}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3"><Link href="/invites" className="text-sm font-medium text-slate-500 hover:text-indigo-600">Invites</Link><Link href="/workspaces" className="text-sm font-medium text-slate-500 hover:text-indigo-600">Workspaces</Link><span className="hidden text-sm text-slate-600 sm:block" data-testid="user-menu">{email}</span><Button variant="outline" size="sm" onClick={signOut} data-testid="sign-out-button"><LogOut /> Sign out</Button></div>
        </div>
        <nav className="mt-3 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3">
          <Link href="/contacts" data-testid="nav-contacts" className={navClass(pathname.startsWith("/contacts"))}><Users /> Contacts</Link>
          <Link href="/companies" data-testid="nav-companies" className={navClass(pathname.startsWith("/companies"))}><Building2 /> Companies</Link>
          <Link href="/deals" data-testid="nav-deals" className={navClass(pathname.startsWith("/deals"))}><BriefcaseBusiness /> Deals</Link>
          {current.role === "owner" && <Link href="/settings/members" data-testid="nav-members" className={navClass(pathname.startsWith("/settings/members"))}><Settings /> Members</Link>}
        </nav>
      </div>

    </header>
  );
}
