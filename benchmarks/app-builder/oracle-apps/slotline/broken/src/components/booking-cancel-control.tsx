"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { dangerButtonClass, secondaryButtonClass } from "@/components/ui-bits";

/**
 * Cancelling keeps the row and flips the status, so this is a status change
 * rather than a delete — but it is still two-step, with an addressable in-page
 * confirmation.
 */
export function BookingCancelControl({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function cancel() {
    setBusy(true);
    setError("");
    const result = await apiFetch(`/api/bookings/${bookingId}/cancel`, {
      method: "POST",
    });
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="booking-cancel-button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        className={dangerButtonClass}
      >
        Cancel appointment
      </button>
      {confirming ? (
        <>
          <button
            type="button"
            data-testid="booking-cancel-confirm"
            onClick={cancel}
            disabled={busy}
            className={dangerButtonClass}
          >
            {busy ? "Cancelling…" : "Yes, cancel it"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className={secondaryButtonClass}
          >
            Keep it
          </button>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
