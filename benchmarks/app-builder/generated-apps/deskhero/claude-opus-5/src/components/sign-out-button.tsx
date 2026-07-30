"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      await authClient.signOut();
    } catch {
      // ignore — always land on the sign-in page
    }
    window.location.href = "/auth/sign-in";
  }

  return (
    <button
      type="button"
      data-testid="sign-out"
      onClick={onClick}
      disabled={pending}
      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
