"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authClient.signUp.email({ email, password, name });
      router.push("/accounts");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create your account.",
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Create your account
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Start keeping books in a couple of minutes.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signup-name" className="text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="signup-name"
          data-testid="signup-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signup-email" className="text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="signup-email"
          data-testid="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className={FIELD}
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
          className={FIELD}
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
      ) : (
        <p data-testid="signup-error" className="hidden" />
      )}

      <button
        type="submit"
        data-testid="signup-submit"
        disabled={loading}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {loading ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
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
