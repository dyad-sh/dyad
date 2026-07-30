"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { AppUser } from "@/lib/tickets";

export function TicketHeader() { const router = useRouter(); const [user, setUser] = useState<AppUser | null>(null); const [deactivated, setDeactivated] = useState(false); useEffect(() => { fetch("/api/me").then(async r => { if (r.status === 403) setDeactivated(true); return r.ok ? r.json() : null; }).then(setUser); }, []); async function signOut() { await authClient.signOut(); router.push("/auth/sign-in"); router.refresh(); } const home = user?.role === "admin" ? "/admin" : user?.role === "agent" ? "/agent" : "/tickets"; return <header className="border-b border-slate-200 bg-white">{deactivated && <div data-testid="account-deactivated" className="bg-red-50 px-5 py-2 text-center text-sm font-medium text-red-700">This account has been deactivated. Please contact an administrator.</div>}<div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5"><Link href={home} className="text-lg font-bold">Desk<span className="text-cyan-600">hero</span></Link><div className="flex items-center gap-3"><span data-testid="role-badge" className="rounded-full bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700">{user?.role ?? ""}</span><span data-testid="user-email" className="hidden text-sm text-slate-500 sm:block">{user?.email}</span><button data-testid="sign-out" onClick={signOut} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600"><LogOut className="size-4" />Sign out</button></div></div></header>; }
