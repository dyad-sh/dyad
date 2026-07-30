"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { errorMessage } from "@/lib/error-message";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      await authClient.signIn.email({ email: email.trim(), password });
      // "/" routes the user to the dashboard that matches their role.
      window.location.href = "/";
    } catch (err) {
      setError(errorMessage(err, "Invalid email or password."));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
      <div className="space-y-1.5">
        <label
          htmlFor="signin-email"
          className="text-sm font-medium text-slate-700"
        >
          Email
        </label>
        <input
          id="signin-email"
          data-testid="signin-email"
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
          htmlFor="signin-password"
          className="text-sm font-medium text-slate-700"
        >
          Password
        </label>
        <input
          id="signin-password"
          data-testid="signin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      {error && (
        <p
          data-testid="signin-error"
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        data-testid="signin-submit"
        disabled={submitting}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/20 disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
