'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AcceptButton({ token }: { token: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function accept() { setPending(true); setError(""); const response = await fetch(`/api/invites/${token}/accept`, { method: "POST" }); if (response.status === 401) { window.location.href = `/auth/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`; return; } const body = await response.json(); if (!response.ok) { setError(body.error ?? "This invite cannot be accepted."); setPending(false); return; } router.push(`/orgs/${body.orgId}`); router.refresh(); }
  return <div className="mt-8"><Button data-testid="accept-invite-submit" disabled={pending} onClick={accept} className="bg-blue-600 hover:bg-blue-700">{pending ? "Accepting…" : "Accept invitation"}</Button>{error && <p data-testid="accept-invite-error" role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}</div>;
}
