"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function AcceptInvite({
  token,
  orgName,
  role,
}: {
  token: string;
  orgName: string;
  role: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const accept = async () => {
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/invites/${token}/accept`, {
      method: "POST",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? "Could not accept the invite.");
      setLoading(false);
      return;
    }
    router.push(`/orgs/${body.orgId}`);
    router.refresh();
  };

  return (
    <div className="space-y-4 text-center">
      <p className="text-sm text-muted-foreground">
        You&apos;ve been invited to join
      </p>
      <p
        data-testid="accept-invite-org-name"
        className="text-lg font-semibold"
      >
        {orgName}
      </p>
      <Badge variant="secondary">as {role}</Badge>
      {error && (
        <p
          data-testid="accept-invite-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Button
        data-testid="accept-invite-submit"
        className="w-full"
        onClick={accept}
        disabled={loading}
      >
        {loading ? "Joining…" : "Accept invite"}
      </Button>
    </div>
  );
}
