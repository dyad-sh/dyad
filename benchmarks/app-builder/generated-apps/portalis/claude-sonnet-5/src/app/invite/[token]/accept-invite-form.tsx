"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface InviteInfo {
  org_name: string;
  status: "pending" | "accepted" | "revoked";
}

export function AcceptInviteForm({
  token,
  invite,
}: {
  token: string;
  invite: InviteInfo | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!invite || invite.status !== "pending") {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">
            Invite unavailable
          </h1>
          <p
            className="mt-2 text-sm text-muted-foreground"
            data-testid="accept-invite-error"
          >
            This invite link is invalid, has been revoked, or was already
            used.
          </p>
        </div>
      </div>
    );
  }

  async function handleAccept() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invites/${token}/accept`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Could not accept invite.");
      }
      router.push(`/orgs/${data.orgId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept invite.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20 text-center">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">
          Join <span data-testid="accept-invite-org-name">{invite.org_name}</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You&apos;ve been invited to join this organization.
        </p>

        {error && (
          <p
            className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="accept-invite-error"
          >
            {error}
          </p>
        )}

        <Button
          className="mt-6 w-full"
          onClick={handleAccept}
          disabled={submitting}
          data-testid="accept-invite-submit"
        >
          {submitting ? "Joining..." : "Accept invite"}
        </Button>
      </div>
    </div>
  );
}
