"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Ticket } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { homePathForRole, type Role } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MeResponse = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMe() {
      try {
        const response = await fetch("/api/me");
        if (!response.ok) {
          if (response.status === 403) {
            router.replace("/account-deactivated");
            return;
          }
          if (!cancelled) setMe(null);
          return;
        }
        const data = (await response.json()) as MeResponse;
        if (!cancelled) setMe(data);
      } catch {
        if (!cancelled) setMe(null);
      }
    }

    void loadMe();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  async function handleSignOut() {
    try {
      await authClient.signOut();
    } catch {
      // still navigate away
    }
    router.push("/auth/sign-in");
    router.refresh();
  }

  const homeHref = me ? homePathForRole(me.role) : "/";

  return (
    <header className="border-b bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link
            href={homeHref}
            className="flex items-center gap-2 font-semibold tracking-tight text-slate-900"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
              <Ticket className="h-4 w-4" />
            </span>
            Deskhero
          </Link>

          {me ? (
            <nav className="hidden items-center gap-3 text-sm lg:flex">
              {me.role === "admin" ? (
                <>
                  <Link
                    href="/admin"
                    className={cn(
                      "text-slate-600 hover:text-slate-900",
                      pathname === "/admin" && "font-medium text-slate-900",
                    )}
                  >
                    Admin
                  </Link>
                  <Link
                    href="/admin/users"
                    className={cn(
                      "text-slate-600 hover:text-slate-900",
                      pathname.startsWith("/admin/users") &&
                        "font-medium text-slate-900",
                    )}
                  >
                    Users
                  </Link>
                  <Link
                    href="/admin/canned"
                    className={cn(
                      "text-slate-600 hover:text-slate-900",
                      pathname.startsWith("/admin/canned") &&
                        "font-medium text-slate-900",
                    )}
                  >
                    Canned
                  </Link>
                  <Link
                    href="/admin/audit"
                    className={cn(
                      "text-slate-600 hover:text-slate-900",
                      pathname.startsWith("/admin/audit") &&
                        "font-medium text-slate-900",
                    )}
                  >
                    Audit
                  </Link>
                  <Link
                    href="/agent"
                    className={cn(
                      "text-slate-600 hover:text-slate-900",
                      pathname.startsWith("/agent") && "font-medium text-slate-900",
                    )}
                  >
                    Agent queue
                  </Link>
                </>
              ) : null}
              {me.role === "agent" ? (
                <Link
                  href="/agent"
                  className={cn(
                    "text-slate-600 hover:text-slate-900",
                    pathname.startsWith("/agent") && "font-medium text-slate-900",
                  )}
                >
                  Queue
                </Link>
              ) : null}
              {me.role === "requester" || me.role === "admin" ? (
                <Link
                  href="/tickets"
                  className={cn(
                    "text-slate-600 hover:text-slate-900",
                    pathname.startsWith("/tickets") && "font-medium text-slate-900",
                  )}
                >
                  My tickets
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {me ? (
            <>
              <Badge
                data-testid="role-badge"
                variant="outline"
                className="capitalize"
              >
                {me.role}
              </Badge>
              <span
                data-testid="user-email"
                className="hidden text-sm text-slate-600 md:inline"
              >
                {me.email}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="sign-out"
                onClick={handleSignOut}
                className="gap-2"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
