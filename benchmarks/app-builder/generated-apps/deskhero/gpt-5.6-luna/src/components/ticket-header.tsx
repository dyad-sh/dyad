"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthSession, authClient } from "@/lib/auth/client";

export function TicketHeader() {
  const { data: session } = useAuthSession();
  const [role, setRole] = useState<string>();
  const [deactivated, setDeactivated] = useState(false);
  useEffect(() => { fetch("/api/me").then(async (response) => { const profile = await response.json(); if (profile.deactivated) setDeactivated(true); else if (response.ok) setRole(profile.role); }); }, []);
  const home = role === "admin" ? "/admin" : role === "agent" ? "/agent" : "/tickets";
  return <><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4"><Link href={home} className="text-lg font-bold tracking-tight text-slate-950"><span className="text-cyan-600">Desk</span>hero</Link><div className="flex items-center gap-4 text-sm"><span data-testid="user-email" className="text-slate-500">{session?.user?.email}</span><span data-testid="role-badge" className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-cyan-700">{role}</span><button data-testid="sign-out" onClick={() => authClient.signOut().then(() => { window.location.href = "/auth/sign-in"; })} className="font-semibold text-slate-700 hover:text-cyan-600">Sign out</button></div></div></header>{deactivated && <div data-testid="account-deactivated" className="bg-rose-600 px-6 py-3 text-center text-sm font-semibold text-white">This account has been deactivated. Contact an administrator for access.</div>}</>;
}
