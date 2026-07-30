"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LifeBuoy, LogOut } from "lucide-react";
import type { Role } from "@/lib/tickets";

type Me = { id: string; email: string; name: string; role: Role };

export function AppHeader() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
        <div className="flex items-center gap-5">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <LifeBuoy className="h-4 w-4" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-slate-900">
              Deskhero
            </span>
          </Link>
          <nav className="flex items-center gap-3 text-sm text-slate-500">
            {me?.role === "admin" && (
              <>
                <Link href="/admin" className="hover:text-slate-900">
                  Dashboard
                </Link>
                <Link href="/admin/users" className="hover:text-slate-900">
                  Users
                </Link>
                <Link href="/admin/canned" className="hover:text-slate-900">
                  Canned
                </Link>
                <Link href="/admin/audit" className="hover:text-slate-900">
                  Audit
                </Link>
              </>
            )}
            {(me?.role === "agent" || me?.role === "admin") && (
              <Link href="/agent" className="hover:text-slate-900">
                Queue
              </Link>
            )}
            <Link href="/tickets" className="hover:text-slate-900">
              Tickets
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {me && (
            <Badge
              variant="secondary"
              data-testid="role-badge"
              className="capitalize bg-indigo-100 text-indigo-700 hover:bg-indigo-100"
            >
              {me.role}
            </Badge>
          )}
          <span
            data-testid="user-email"
            className="hidden text-sm text-slate-500 sm:inline"
          >
            {me?.email}
          </span>
          <Button
            variant="outline"
            size="sm"
            data-testid="sign-out"
            onClick={handleSignOut}
          >
            <LogOut className="mr-1.5 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
