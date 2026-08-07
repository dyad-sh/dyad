"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export function MemberAddForm({ bookId }: { bookId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("bookkeeper");
  const [error, setError] = useState("");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch(`/api/books/${bookId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
      keepalive: true,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body?.error ?? "That member could not be added.");
      return;
    }
    setEmail("");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
      noValidate
    >
      <div className="space-y-1.5">
        <label htmlFor="member-add-email" className="text-sm font-medium text-slate-700">
          Email of an existing user
        </label>
        <input
          id="member-add-email"
          data-testid="member-add-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="member-add-role" className="text-sm font-medium text-slate-700">
          Role
        </label>
        <select
          id="member-add-role"
          data-testid="member-add-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className={FIELD}
        >
          <option value="owner">owner</option>
          <option value="bookkeeper">bookkeeper</option>
        </select>
      </div>

      <button
        type="submit"
        data-testid="member-add-submit"
        className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        Add member
      </button>

      {error ? (
        <p
          data-testid="member-add-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-3"
        >
          {error}
        </p>
      ) : (
        <p data-testid="member-add-error" className="hidden" />
      )}
    </form>
  );
}
