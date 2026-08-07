"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STARS = [1, 2, 3, 4, 5];

/**
 * Rating a delivered order. Whether a rating is allowed is decided by the
 * server — this control only reports what it answered, so a refused re-rating
 * shows in `order-rate-error` instead of appearing to succeed.
 */
export function RateOrder({
  orderId,
  ratingStars,
}: {
  orderId: string;
  ratingStars: number | null;
}) {
  const router = useRouter();
  const [stars, setStars] = useState(String(ratingStars ?? 5));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setError("");
    setPending(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/rate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stars: Number(stars) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "That rating was refused.");
        return;
      }
      router.refresh();
    } catch {
      setError("That rating was refused.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Rate this order
      </h2>

      {ratingStars !== null ? (
        <p className="text-sm text-zinc-600">
          You rated this order{" "}
          <span
            data-testid="order-rating"
            data-stars={ratingStars}
            className="font-semibold text-zinc-900"
          >
            {ratingStars} {ratingStars === 1 ? "star" : "stars"}
          </span>
          .
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <label htmlFor="order-rate-stars" className="text-sm text-zinc-600">
          Stars
        </label>
        <select
          id="order-rate-stars"
          data-testid="order-rate-stars"
          value={stars}
          onChange={(event) => setStars(event.target.value)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
        >
          {STARS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="order-rate-submit"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Submit rating"}
        </button>
      </div>

      {error ? (
        <p
          data-testid="order-rate-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
