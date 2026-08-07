"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELD =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

export function RestaurantForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const response = await fetch("/api/restaurants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, cuisine, address }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Could not create the restaurant.");
        return;
      }
      // The write has already come back, so the page we navigate to reads a
      // database that certainly contains it.
      router.push(`/restaurants/${body.id}/manage`);
      router.refresh();
    } catch {
      setError("Could not create the restaurant.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label
          htmlFor="restaurant-form-name"
          className="text-sm font-medium text-zinc-700"
        >
          Name
        </label>
        <input
          id="restaurant-form-name"
          data-testid="restaurant-form-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="restaurant-form-cuisine"
          className="text-sm font-medium text-zinc-700"
        >
          Cuisine
        </label>
        <input
          id="restaurant-form-cuisine"
          data-testid="restaurant-form-cuisine"
          value={cuisine}
          onChange={(event) => setCuisine(event.target.value)}
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="restaurant-form-address"
          className="text-sm font-medium text-zinc-700"
        >
          Address
        </label>
        <input
          id="restaurant-form-address"
          data-testid="restaurant-form-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className={FIELD}
        />
      </div>

      {error ? (
        <p
          data-testid="restaurant-form-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : (
        <p data-testid="restaurant-form-error" className="hidden" />
      )}

      <button
        type="submit"
        data-testid="restaurant-form-submit"
        disabled={saving}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
      >
        {saving ? "Creating…" : "Create restaurant"}
      </button>
    </form>
  );
}
