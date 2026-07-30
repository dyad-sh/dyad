"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  token: string;
  orgName: string;
};

export function AcceptInviteForm({ token, orgName }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onAccept() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        orgId?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Unable to accept invite");
        setPending(false);
        return;
      }
      router.push(data.orgId ? `/orgs/${data.orgId}` : "/orgs");
      router.refresh();
    } catch {
      setError("Unable to accept invite");
      setPending(false);
    }
  }

  return (
    <div className="space-y-6 text-center">
      <div>
        <p className="text-sm text-muted-foreground">
          You&apos;ve been invited to join
        </p>
        <h1
          data-testid="accept-invite-org-name"
          className="mt-2 text-2xl font-semibold tracking-tight"
        >
          {orgName}
        </h1>
      </div>

      {error ? (
        <p
          data-testid="accept-invite-error"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        data-testid="accept-invite-submit"
        className="h-11 w-full"
        disabled={pending}
        onClick={onAccept}
      >
        {pending ? "Accepting…" : "Accept invitation"}
      </Button>
    </div>
  );
}
