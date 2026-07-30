"use client";

import { useState } from "react";

export function AcceptInvite({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);
  async function accept() {
    setAccepting(true); setError("");
    const response = await fetch(`/api/invites/${token}/accept`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "This invite can no longer be accepted."); setAccepting(false); return; }
    window.location.assign(`/orgs/${body.orgId}`);
  }
  return <><button data-testid="accept-invite-submit" onClick={accept} disabled={accepting} className="mt-6 w-full rounded-xl bg-slate-950 px-4 py-3 font-medium text-white disabled:opacity-60">{accepting ? "Accepting…" : "Accept invitation"}</button>{error && <p data-testid="accept-invite-error" role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}</>;
}
