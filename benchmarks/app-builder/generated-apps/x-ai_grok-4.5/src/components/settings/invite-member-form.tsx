"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INVITE_ROLES } from "@/lib/types";

export function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to send invite");
        return;
      }
      setEmail("");
      setRole("member");
      router.refresh();
    } catch {
      setError("Failed to send invite");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="space-y-2">
        <Label htmlFor="invite-email-input">Invite by email</Label>
        <Input
          id="invite-email-input"
          data-testid="invite-email-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="teammate@company.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-role-select">Role</Label>
        <select
          id="invite-role-select"
          data-testid="invite-role-select"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={role}
          onChange={(e) => setRole(e.target.value as "member" | "viewer")}
        >
          {INVITE_ROLES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <p
        data-testid="invite-error"
        className={
          error ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" : "sr-only"
        }
        role="alert"
      >
        {error}
      </p>
      <Button type="submit" data-testid="invite-submit" disabled={loading}>
        {loading ? "Sending…" : "Send invite"}
      </Button>
    </form>
  );
}
