"use client";

import { useRouter } from "next/navigation";
import { LogOut, ShieldOff } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AccountDeactivatedPage() {
  const router = useRouter();

  async function handleSignOut() {
    try {
      await authClient.signOut();
    } catch {
      // still leave
    }
    router.push("/auth/sign-in");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-rose-50 px-4">
      <Card className="w-full max-w-md border-slate-200/80 shadow-xl">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-600 text-white">
            <ShieldOff className="h-5 w-5" />
          </div>
          <CardTitle className="text-2xl">Account deactivated</CardTitle>
          <CardDescription data-testid="account-deactivated">
            Your Deskhero account has been deactivated by an administrator.
            You can no longer access tickets or make API requests. Contact an
            admin if you believe this is a mistake.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            data-testid="sign-out"
            onClick={handleSignOut}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
