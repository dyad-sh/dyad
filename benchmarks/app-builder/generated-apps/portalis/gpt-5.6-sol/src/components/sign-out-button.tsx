"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.replace("/auth/sign-in");
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" onClick={signOut} data-testid="sign-out-button">
      <LogOut /> Sign out
    </Button>
  );
}
