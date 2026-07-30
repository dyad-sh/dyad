"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function SiteHeader() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setEmail(data.email);
          setRole(data.role);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  }

  const homeHref =
    role === "admin" ? "/admin" : role === "agent" ? "/agent" : "/tickets";

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
        <Link href={homeHref} className="text-lg font-semibold text-slate-900">
          Deskhero
        </Link>
        <div className="flex items-center gap-4">
          {role && (
            <Badge data-testid="role-badge" variant="secondary">
              {role}
            </Badge>
          )}
          {email && (
            <span data-testid="user-email" className="text-sm text-slate-600">
              {email}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            data-testid="sign-out"
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
