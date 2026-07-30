"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WORKSPACE_ROLES } from "@/lib/types";

export function MemberRowActions({
  workspaceId,
  memberId,
  role,
  isSelf,
}: {
  workspaceId: string;
  memberId: string;
  role: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [nextRole, setNextRole] = useState(role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const base = `/api/workspaces/${workspaceId}/members/${memberId}`;

  async function saveRole() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not update this role.");
        setNextRole(role);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not update this role.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(base, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not remove this member.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not remove this member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select
        data-testid="member-role-select"
        value={nextRole}
        disabled={busy || isSelf}
        onChange={(e) => setNextRole(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs capitalize outline-none transition focus:border-slate-900 disabled:opacity-60"
      >
        {WORKSPACE_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid="member-role-save"
        onClick={saveRole}
        disabled={busy || isSelf}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
      >
        Save
      </button>
      <button
        type="button"
        data-testid="member-remove-button"
        onClick={() => setError("")}
        disabled={busy || isSelf}
        className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
      >
        Remove
      </button>
      <button
        type="button"
        data-testid="member-remove-confirm"
        onClick={remove}
        disabled={busy || isSelf}
        className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
      >
        Confirm
      </button>
      {error ? (
        <span className="w-full text-right text-xs text-red-600">{error}</span>
      ) : null}
    </div>
  );
}
