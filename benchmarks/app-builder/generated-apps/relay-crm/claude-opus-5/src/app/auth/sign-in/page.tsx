"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authClient.signIn.email({ email, password });
      router.push("/contacts");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid email or password.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Welcome back</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sign in to continue to Relay CRM.
        </p>
      </div>

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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      {error ? (
        <p
          data-testid="signin-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : (
        <p data-testid="signin-error" className="hidden" />
      )}

      <button
        type="submit"
        data-testid="signin-submit"
        disabled={loading}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-slate-500">
        Need an account?{" "}
        <Link
          href="/auth/sign-up"
          className="font-medium text-slate-900 underline-offset-4 hover:underline"
        >
          Sign up
        </Link>
      </p>
    </form>
  );
}
