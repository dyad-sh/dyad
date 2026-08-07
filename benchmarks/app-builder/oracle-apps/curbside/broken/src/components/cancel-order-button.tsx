"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Cancelling is decided by the server: this control only reports what it
 * answered. `order-cancel-error` carries the server's own message.
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function cancel() {
    setError("");
    setPending(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      // The server may report a refusal either as an error status or as a 200
      // carrying `{ ok: false, error }` — see ORACLE-DEFECT D12.
      if (!response.ok || body?.error) {
        setError(body?.error ?? "That order can no longer be cancelled.");
        return;
      }
      router.refresh();
    } catch {
      setError("That order can no longer be cancelled.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        data-testid="order-cancel-button"
        onClick={cancel}
        disabled={pending}
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-60"
      >
        {pending ? "Cancelling…" : "Cancel order"}
      </button>
      {error ? (
        <p
          data-testid="order-cancel-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
