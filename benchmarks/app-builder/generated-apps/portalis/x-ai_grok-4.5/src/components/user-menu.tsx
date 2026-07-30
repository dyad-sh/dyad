"use client";

import { useRouter } from "next/navigation";
import { authClient, useAuthSession } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="h-9 w-40 animate-pulse rounded-md bg-muted" aria-hidden />
    );
  }

  if (!session?.user) {
    return null;
  }

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  }

  return (
    <div
      data-testid="user-menu"
      className="flex items-center gap-3 rounded-full border border-border/80 bg-card/80 px-3 py-1.5 shadow-sm backdrop-blur"
    >
      <span
        data-testid="user-email"
        className="max-w-[220px] truncate text-sm text-muted-foreground"
      >
        {session.user.email}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="sign-out-button"
        onClick={handleSignOut}
        className="h-8 px-2 text-sm"
      >
        Sign out
      </Button>
    </div>
  );
}
