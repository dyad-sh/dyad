'use client';

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

type Org = { id: string; name: string; slug: string };
type Props = { email: string };

export function PortalHeader({ email }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [orgs, setOrgs] = useState<Org[]>([]);
  useEffect(() => { fetch("/api/orgs").then((response) => response.ok ? response.json() : []).then(setOrgs); }, []);
  async function signOut() { await authClient.signOut(); router.push("/auth/sign-in"); router.refresh(); }
  const activeId = pathname.match(/^\/orgs\/([^/]+)/)?.[1];

  return <header className="border-b bg-white/80 backdrop-blur"><div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-6 py-3"><div className="flex items-center gap-6"><a href="/orgs" className="text-lg font-semibold tracking-tight text-slate-950">Portalis</a>{orgs.length > 0 && <label data-testid="org-switcher" className="flex items-center gap-2 text-sm text-slate-500"><span className="hidden sm:inline">Organization</span><select value={activeId ?? ""} onChange={(event) => event.target.value && router.push(`/orgs/${event.target.value}`)} className="max-w-44 rounded-md border border-slate-200 bg-white px-2 py-1.5 font-medium text-slate-700"><option value="" disabled>Select organization</option>{orgs.map((org) => <option data-testid="org-switcher-option" data-org-id={org.id} key={org.id} value={org.id}>{org.name}</option>)}</select></label>}</div><div data-testid="user-menu" className="flex items-center gap-4 text-sm"><span data-testid="user-email" className="hidden text-slate-600 sm:inline">{email}</span><Button data-testid="sign-out-button" variant="outline" size="sm" onClick={signOut}>Sign out</Button></div></div></header>;
}
