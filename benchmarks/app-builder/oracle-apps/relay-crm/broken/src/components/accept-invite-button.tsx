"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptInviteButton({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/invites/${inviteId}/accept`, {
        method: "POST",
        keepalive: true,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not accept this invite.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not accept this invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="ml-auto flex items-center gap-3">
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
      <button
        type="button"
        data-testid="invite-accept-button"
        onClick={accept}
        disabled={busy}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {busy ? "Accepting…" : "Accept"}
      </button>
    </span>
  );
}
