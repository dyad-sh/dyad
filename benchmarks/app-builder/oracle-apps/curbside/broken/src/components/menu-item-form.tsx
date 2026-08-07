"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELD =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

/** Prices are captured as an integer number of cents — never as dollars. */
export function MenuItemForm({ restaurantId }: { restaurantId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceCents, setPriceCents] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const response = await fetch(
        `/api/restaurants/${restaurantId}/menu-items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            description,
            priceCents: Number(priceCents),
          }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Could not add the menu item.");
        return;
      }
      setName("");
      setDescription("");
      setPriceCents("");
      router.refresh();
    } catch {
      setError("Could not add the menu item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label
          htmlFor="menu-item-form-name"
          className="text-sm font-medium text-zinc-700"
        >
          Item
        </label>
        <input
          id="menu-item-form-name"
          data-testid="menu-item-form-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="menu-item-form-description"
          className="text-sm font-medium text-zinc-700"
        >
          Description
        </label>
        <textarea
          id="menu-item-form-description"
          data-testid="menu-item-form-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="menu-item-form-price-cents"
          className="text-sm font-medium text-zinc-700"
        >
          Price (cents)
        </label>
        <input
          id="menu-item-form-price-cents"
          data-testid="menu-item-form-price-cents"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={priceCents}
          onChange={(event) => setPriceCents(event.target.value)}
          className={FIELD}
        />
      </div>

      {error ? (
        <p
          data-testid="menu-item-form-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : (
        <p data-testid="menu-item-form-error" className="hidden" />
      )}

      <button
        type="submit"
        data-testid="menu-item-form-submit"
        disabled={saving}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
      >
        {saving ? "Adding…" : "Add to menu"}
      </button>
    </form>
  );
}
