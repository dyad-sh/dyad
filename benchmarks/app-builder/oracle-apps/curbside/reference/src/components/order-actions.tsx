"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrderStatus } from "@/lib/types";

/**
 * Drives one lifecycle edge. Which edges are offered is decided on the server
 * from the same state machine the transition route enforces, so this control is
 * never rendered for an edge the server would refuse.
 */
export function TransitionButton({
  orderId,
  to,
  label,
}: {
  orderId: string;
  to: OrderStatus;
  label: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function drive() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "That change was refused.");
        return;
      }
      router.refresh();
    } catch {
      setError("That change was refused.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        data-testid={`transition-${to}`}
        onClick={drive}
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
      >
        {pending ? "Saving…" : label}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Claims a delivery for the signed-in courier. */
export function ClaimButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function claim() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/deliveries/${orderId}/claim`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "That delivery is no longer available.");
        return;
      }
      router.refresh();
    } catch {
      setError("That delivery is no longer available.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        data-testid="claim-button"
        onClick={claim}
        disabled={pending}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Claiming…" : "Claim"}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** `/courier` is open to everybody; this is where a user becomes a courier. */
export function CourierRegisterButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function register() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/courier/register", {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Could not register you as a courier.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not register you as a courier.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        data-testid="courier-register-button"
        onClick={register}
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
      >
        {pending ? "Registering…" : "Register as a courier"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
