"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      // The managed auth service signs the new account in immediately.
      await authClient.signUp.email({ email, password, name });
      router.push("/bookings");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We could not create that account.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Create your account
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Book appointments with the clinic in a couple of clicks.
        </p>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="signup-name"
          className="text-sm font-medium text-slate-700"
        >
          Full name
        </label>
        <input
          id="signup-name"
          data-testid="signup-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      {error ? (
        <p
          data-testid="signup-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        data-testid="signup-submit"
        disabled={busy}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {busy ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-sm text-slate-500">
        Already registered?{" "}
        <Link
          href="/auth/sign-in"
          className="font-medium text-slate-900 underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
