"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import {
  WorkspaceSwitcher,
  type SwitcherWorkspace,
} from "@/components/workspace-switcher";
import { canManageMembers } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/contacts", label: "Contacts", testId: "nav-contacts" },
  { href: "/companies", label: "Companies", testId: "nav-companies" },
  { href: "/deals", label: "Deals", testId: "nav-deals" },
  { href: "/settings/members", label: "Members", testId: "nav-members", ownerOnly: true },
  { href: "/workspaces", label: "Workspaces", testId: "nav-workspaces" },
  { href: "/invites", label: "Invites", testId: "nav-invites" },
];

export function AppHeader({
  email,
  role,
  workspaces,
  activeWorkspaceId,
}: {
  email: string;
  role: string;
  workspaces: SwitcherWorkspace[];
  activeWorkspaceId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const nav = NAV.filter((item) => !item.ownerOnly || canManageMembers(role));

  async function signOut() {
    try {
      await authClient.signOut();
    } finally {
      router.push("/auth/sign-in");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <Link href="/contacts" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
            R
          </span>
          <span className="text-sm font-semibold text-slate-900">
            Relay CRM
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-testid={item.testId}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition",
                pathname === item.href || pathname.startsWith(`${item.href}/`)
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeId={activeWorkspaceId}
          />
          <span
            data-testid="user-menu"
            className="max-w-[200px] truncate text-sm text-slate-600"
          >
            {email}
          </span>
          <button
            type="button"
            data-testid="sign-out-button"
            onClick={signOut}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
