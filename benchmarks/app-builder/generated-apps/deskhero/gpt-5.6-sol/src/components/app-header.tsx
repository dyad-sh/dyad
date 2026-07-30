'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LifeBuoy, LogOut } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import type { CurrentUser } from "@/lib/auth/current-user";

export function AppHeader({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const home = user.role === "admin" ? "/admin" : user.role === "agent" ? "/agent" : "/tickets";

  async function signOut() {
    await authClient.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-5">
          <Link href={home} className="flex items-center gap-2.5 font-bold tracking-tight text-slate-950">
            <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white"><LifeBuoy className="size-4" /></span>
            Deskhero
          </Link>
          {user.role !== "requester" && <Link href="/tickets" className="hidden text-sm font-medium text-slate-500 hover:text-slate-900 sm:block">Tickets</Link>}
          {user.role === "admin" && <Link href="/admin/users" className="hidden text-sm font-medium text-slate-500 hover:text-slate-900 sm:block">Users</Link>}
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <span data-testid="role-badge" className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold capitalize text-indigo-700">{user.role}</span>
          <span data-testid="user-email" className="hidden text-sm text-slate-500 md:inline">{user.email}</span>
          <button data-testid="sign-out" onClick={signOut} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
            <LogOut className="size-4" /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
