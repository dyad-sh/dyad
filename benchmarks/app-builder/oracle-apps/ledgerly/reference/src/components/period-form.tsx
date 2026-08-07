"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export function PeriodForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/periods", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, startDate, endDate }),
      keepalive: true,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body?.error ?? "That period could not be created.");
      return;
    }
    setName("");
    setStartDate("");
    setEndDate("");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-4 sm:grid-cols-[1fr_11rem_11rem_auto] sm:items-end"
      noValidate
    >
      <div className="space-y-1.5">
        <label htmlFor="period-new-name" className="text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="period-new-name"
          data-testid="period-new-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={FIELD}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="period-new-start" className="text-sm font-medium text-slate-700">
          Start
        </label>
        <input
          id="period-new-start"
          data-testid="period-new-start"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className={FIELD}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="period-new-end" className="text-sm font-medium text-slate-700">
          End
        </label>
        <input
          id="period-new-end"
          data-testid="period-new-end"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className={FIELD}
        />
      </div>
      <button
        type="submit"
        data-testid="period-new-submit"
        className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        Create period
      </button>

      {error ? (
        <p
          data-testid="period-form-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-4"
        >
          {error}
        </p>
      ) : (
        <p data-testid="period-form-error" className="hidden" />
      )}
    </form>
  );
}
