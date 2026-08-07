"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { dangerButtonClass, secondaryButtonClass } from "@/components/ui-bits";

/**
 * Two-step delete with an in-page confirmation control, so the confirmation is
 * addressable rather than a native dialog. Rendered only for the row being
 * deleted, never once per row.
 */
export function DeleteControl({
  endpoint,
  redirectTo,
  buttonTestId,
  confirmTestId,
  label,
}: {
  endpoint: string;
  redirectTo: string;
  buttonTestId: string;
  confirmTestId: string;
  label: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setBusy(true);
    setError("");
    const result = await apiFetch(endpoint, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      setConfirming(false);
      setError(result.error);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid={buttonTestId}
        onClick={() => setConfirming(true)}
        disabled={busy}
        className={dangerButtonClass}
      >
        {label}
      </button>
      {confirming ? (
        <>
          <button
            type="button"
            data-testid={confirmTestId}
            onClick={remove}
            disabled={busy}
            className={dangerButtonClass}
          >
            {busy ? "Deleting…" : "Yes, delete"}
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
