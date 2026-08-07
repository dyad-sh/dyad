"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export function AccountForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("debit");
  const [error, setError] = useState("");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name, type }),
      keepalive: true,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body?.error ?? "That account could not be created.");
      return;
    }
    router.push("/accounts");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="account-form-code" className="text-sm font-medium text-slate-700">
          Code
        </label>
        <input
          id="account-form-code"
          data-testid="account-form-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="account-form-name" className="text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="account-form-name"
          data-testid="account-form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="account-form-type" className="text-sm font-medium text-slate-700">
          Normal balance
        </label>
        <select
          id="account-form-type"
          data-testid="account-form-type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className={FIELD}
        >
          <option value="debit">debit</option>
          <option value="credit">credit</option>
        </select>
      </div>

      {error ? (
        <p
          data-testid="account-form-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        data-testid="account-form-submit"
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        Create account
      </button>
    </form>
  );
}
