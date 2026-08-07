"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteRecord({
  endpoint,
  redirectTo,
  label,
  deleteTestId,
  confirmTestId,
}: {
  endpoint: string;
  redirectTo: string;
  label: string;
  deleteTestId: string;
  confirmTestId: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onDelete() {
    setBusy(true);
    setError("");
    try {
      // `keepalive` so the delete still reaches the server when the click is
      // immediately followed by a navigation.
      const res = await fetch(endpoint, { method: "DELETE", keepalive: true });
      if (!res.ok) {
        setError("Could not delete this record.");
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Could not delete this record.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
      <p className="text-sm font-medium text-red-900">
        {armed ? `Are you sure? This ${label} will be removed permanently.` : `Delete this ${label}`}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid={deleteTestId}
          onClick={() => setArmed(true)}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
        >
          Delete
        </button>
        <button
          type="button"
          data-testid={confirmTestId}
          onClick={onDelete}
          disabled={busy}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
        >
          {busy ? "Deleting…" : "Confirm delete"}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
