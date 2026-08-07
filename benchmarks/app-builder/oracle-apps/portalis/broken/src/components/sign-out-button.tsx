"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      await authClient.signOut();
    } catch {
      // fall through to redirect regardless
    }
    router.replace("/auth/sign-in");
    router.refresh();
  }

  return (
    <button
      type="button"
      data-testid="sign-out-button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
    >
      <LogOut className="h-3.5 w-3.5" />
      Sign out
    </button>
  );
}
