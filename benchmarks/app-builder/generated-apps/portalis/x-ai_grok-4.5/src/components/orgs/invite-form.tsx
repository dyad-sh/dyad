"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  orgId: string;
};

export function InviteForm({ orgId }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"org_admin" | "org_member">("org_member");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const res = await fetch(`/api/orgs/${orgId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to send invite");
        setPending(false);
        return;
      }
      setEmail("");
      setRole("org_member");
      setPending(false);
      router.refresh();
    } catch {
      setError("Failed to send invite");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <div className="space-y-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          data-testid="invite-email-input"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="colleague@company.com"
          className="h-10"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          data-testid="invite-role-select"
          value={role}
          onChange={(e) =>
            setRole(e.target.value as "org_admin" | "org_member")
          }
          className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-40"
        >
          <option value="org_member">org_member</option>
          <option value="org_admin">org_admin</option>
        </select>
      </div>
      <Button type="submit" data-testid="invite-submit" disabled={pending}>
        {pending ? "Inviting…" : "Invite"}
      </Button>
      {error ? (
        <p className="text-sm text-destructive sm:col-span-3" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
