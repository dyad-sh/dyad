"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Enter an email address.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not send this invite.");
        return;
      }
      setEmail("");
      router.refresh();
    } catch {
      setError("Could not send this invite.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-6"
    >
      <div className="space-y-1.5">
        <label htmlFor="invite-email" className="text-sm font-medium text-slate-700">
          Invite by email
        </label>
        <div className="flex gap-2">
          <input
            id="invite-email"
            data-testid="invite-email-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
          <select
            data-testid="invite-role-select"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Invite role"
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm capitalize outline-none transition focus:border-slate-900"
          >
            <option value="member">member</option>
            <option value="viewer">viewer</option>
          </select>
          <button
            type="submit"
            data-testid="invite-submit"
            disabled={saving}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "Inviting…" : "Invite"}
          </button>
        </div>
      </div>
      {error ? (
        <p
          data-testid="invite-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : (
        <p data-testid="invite-error" className="hidden" />
      )}
    </form>
  );
}
