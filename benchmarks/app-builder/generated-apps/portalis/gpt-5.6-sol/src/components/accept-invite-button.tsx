"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function accept() { setBusy(true); setError(""); const response = await fetch(`/api/invites/${token}/accept`, { method: "POST" }); const data = await response.json(); setBusy(false); if (!response.ok) { setError(data.error ?? "Unable to accept this invite."); return; } router.push(`/orgs/${data.orgId}`); router.refresh(); }
  return <div className="mt-6">{error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="accept-invite-error">{error}</p>}<Button className="w-full bg-sky-600 hover:bg-sky-700" onClick={accept} disabled={busy} data-testid="accept-invite-submit">{busy && <Loader2 className="animate-spin" />}Accept invite</Button></div>;
}
