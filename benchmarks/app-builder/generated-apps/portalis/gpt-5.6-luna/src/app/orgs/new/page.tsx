'use client';

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PortalHeader } from "@/components/portal-header";
import { authClient } from "@/lib/auth/client";

export default function NewOrgPage() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/orgs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), slug: form.get("slug") }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); router.push(`/orgs/${body.id}`); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create organization."); } finally { setPending(false); }
  }
  return <div className="min-h-screen bg-slate-50"><PortalHeader email={session?.user?.email ?? ""} /><main className="mx-auto max-w-2xl px-6 py-12"><Link href="/orgs" className="text-sm font-medium text-blue-600 hover:underline">← Back to organizations</Link><section className="mt-6 rounded-2xl border bg-white p-8 shadow-sm"><h1 className="text-3xl font-semibold tracking-tight text-slate-950">Create organization</h1><p className="mt-2 text-sm text-slate-500">Give your new workspace a clear identity.</p><form onSubmit={submit} className="mt-8 space-y-6"><label className="block text-sm font-medium text-slate-700">Organization name<Input data-testid="org-name-input" name="name" required className="mt-2 h-11" /></label><label className="block text-sm font-medium text-slate-700">Slug<Input data-testid="org-slug-input" name="slug" pattern="[a-z0-9-]+" required className="mt-2 h-11" /><span className="mt-2 block text-xs text-slate-500">Lowercase letters, numbers, and hyphens only.</span></label>{error && <p data-testid="create-org-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<Button data-testid="create-org-submit" disabled={pending} className="bg-blue-600 hover:bg-blue-700">{pending ? "Creating…" : "Create organization"}</Button></form></section></main></div>;
}
