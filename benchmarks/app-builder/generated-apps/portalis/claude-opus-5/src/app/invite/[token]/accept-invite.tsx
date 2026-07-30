"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AcceptInvite({
  token,
  orgId,
}: {
  token: string;
  orgId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function accept() {
    setError(null);
    setPending(true);
    const res = await fetch(`/api/invites/${token}/accept`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "This invite could not be accepted.");
      setPending(false);
      return;
    }
    router.replace(`/orgs/${orgId}`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        data-testid="accept-invite-submit"
        onClick={accept}
        disabled={pending}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Joining…" : "Accept invitation"}
      </button>
      {error && (
        <p
          data-testid="accept-invite-error"
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
