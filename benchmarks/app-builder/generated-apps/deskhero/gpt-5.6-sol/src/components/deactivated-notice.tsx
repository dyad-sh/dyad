'use client';

import { useRouter } from "next/navigation";
import { ShieldX } from "lucide-react";

import { authClient } from "@/lib/auth/client";

export function DeactivatedNotice() {
  const router = useRouter();
  async function signOut() {
    await authClient.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  }
  return <div data-testid="account-deactivated" className="text-center"><span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600"><ShieldX className="size-7" /></span><h1 className="mt-5 text-2xl font-bold text-slate-950">Account deactivated</h1><p className="mt-3 text-sm leading-6 text-slate-500">Your Deskhero access has been disabled. Contact an administrator if you believe this is a mistake.</p><button onClick={signOut} className="mt-7 h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-800">Sign out</button></div>;
}
