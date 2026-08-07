"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Close and reopen. Rendered only for an owner — but the endpoints check the
 * caller's role in the database on every request, so hiding the control is
 * presentation, never the enforcement.
 */
export function PeriodActions({
  periodId,
  status,
}: {
  periodId: string;
  status: "open" | "closed";
}) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function call(action: "close" | "reopen") {
    setError("");
    const response = await fetch(`/api/periods/${periodId}/${action}`, {
      method: "POST",
      keepalive: true,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body?.error ?? "That change could not be made.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {status === "open" ? (
        <button
          type="button"
          data-testid="period-close-button"
          onClick={() => call("close")}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Close period
        </button>
      ) : (
        <button
          type="button"
          data-testid="period-reopen-button"
          onClick={() => call("reopen")}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Reopen period
        </button>
      )}

      {error ? (
        <p
          data-testid="period-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : (
        <p data-testid="period-error" className="hidden" />
      )}
    </div>
  );
}
