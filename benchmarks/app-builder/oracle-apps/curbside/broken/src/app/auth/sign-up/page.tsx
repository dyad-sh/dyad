"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

const FIELD =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

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
      // The project's managed email/password service: signing up also signs in.
      await authClient.signUp.email({ email, password, name });
      router.push("/restaurants");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create your account.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">
          Create your account
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Order in a couple of taps, or list your own kitchen.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signup-name" className="text-sm font-medium text-zinc-700">
          Name
        </label>
        <input
          id="signup-name"
          data-testid="signup-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="signup-email"
          className="text-sm font-medium text-zinc-700"
        >
          Email
        </label>
        <input
          id="signup-email"
          data-testid="signup-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="signup-password"
          className="text-sm font-medium text-zinc-700"
        >
          Password
        </label>
        <input
          id="signup-password"
          data-testid="signup-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
        className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
      >
        {loading ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link
          href="/auth/sign-in"
          className="font-medium text-zinc-900 underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
