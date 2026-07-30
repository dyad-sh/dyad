"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";

export function AccountDeactivated() {
  const router = useRouter();

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  };

  return (
    <div
      data-testid="account-deactivated"
      className="flex flex-col items-center gap-4 rounded-xl border border-red-200 bg-red-50/60 py-16 text-center"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
        <Ban className="h-6 w-6" />
      </span>
      <div>
        <p className="font-semibold text-slate-900">
          Your account has been deactivated
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Contact an administrator if you believe this is a mistake.
        </p>
      </div>
      <Button variant="outline" onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  );
}
