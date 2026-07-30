"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { errorMessage } from "@/lib/error-message";

export function SignUpForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !password) {
      setError("Name, email and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      // "/" routes the user to the dashboard that matches their role.
      window.location.href = "/";
    } catch (err) {
      setError(errorMessage(err, "Could not create your account."));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
      <div className="space-y-1.5">
        <label
          htmlFor="signup-name"
          className="text-sm font-medium text-slate-700"
        >
          Name
        </label>
        <input
          id="signup-name"
          data-testid="signup-name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ada Lovelace"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="signup-email"
          className="text-sm font-medium text-slate-700"
        >
          Email
        </label>
        <input
          id="signup-email"
          data-testid="signup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="signup-password"
          className="text-sm font-medium text-slate-700"
        >
          Password
        </label>
        <input
          id="signup-password"
          data-testid="signup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      {error && (
        <p
          data-testid="signup-error"
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        data-testid="signup-submit"
        disabled={submitting}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/20 disabled:opacity-60"
      >
        {submitting ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
