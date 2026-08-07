"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { AppUser } from "@/lib/tickets";

export function TicketHeader() {
  const [user, setUser] = useState<AppUser | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then(async (response) => (response.ok ? response.json() : null))
      .then(setUser);
  }, []);

  const home =
    user?.role === "admin"
      ? "/admin"
      : user?.role === "agent"
        ? "/agent"
        : "/tickets";

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
        <Link href={home} className="text-lg font-bold tracking-tight">
          Desk<span className="text-cyan-600">hero</span>
        </Link>
        <div className="flex items-center gap-3">
          <span
            data-testid="role-badge"
            className="rounded-full bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700"
          >
            {user?.role ?? ""}
          </span>
          <span
            data-testid="user-email"
            className="hidden text-sm text-slate-500 sm:block"
          >
            {user?.email}
          </span>
          {/* A real form POST, not a background fetch: the session must be
              revoked server-side before the browser goes anywhere else. */}
          <form action="/api/sign-out" method="post">
            <button
              data-testid="sign-out"
              type="submit"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
