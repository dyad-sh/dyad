"use client";

import { authClient } from "@/lib/auth/client";

export function UserMenu({ email }: { email: string }) {
  async function signOut() {
    await authClient.signOut();
    window.location.assign("/auth/sign-in");
  }

  return <div data-testid="user-menu" className="flex items-center gap-3 text-sm">
    <span data-testid="user-email" className="hidden text-slate-500 sm:inline">{email}</span>
    <button data-testid="sign-out-button" onClick={signOut} className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">Sign out</button>
  </div>;
}
