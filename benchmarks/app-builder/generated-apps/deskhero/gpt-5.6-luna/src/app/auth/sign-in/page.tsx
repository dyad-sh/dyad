"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth/client";

export default function SignInPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      await authClient.signIn.email({ email: String(form.get("email")), password: String(form.get("password")) });
      const profile = await fetch("/api/me").then((response) => response.json());
      window.location.href = profile.role === "admin" ? "/admin" : profile.role === "agent" ? "/agent" : "/tickets";

    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center">
        <div className="mb-8"><p className="mb-3 text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">Deskhero</p><h1 className="text-4xl font-semibold tracking-tight">Welcome back.</h1><p className="mt-3 text-slate-400">Sign in to manage your helpdesk tickets.</p></div>
        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.06] p-7 shadow-2xl shadow-cyan-950/30">
          <label className="block text-sm font-medium text-slate-200">Email<input data-testid="signin-email" name="email" type="email" required className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 outline-none transition focus:border-cyan-300" /></label>
          <label className="block text-sm font-medium text-slate-200">Password<input data-testid="signin-password" name="password" type="password" required className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 outline-none transition focus:border-cyan-300" /></label>
          {error && <p data-testid="signin-error" className="rounded-lg bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
          {!error && <p data-testid="signin-error" className="hidden" aria-hidden="true" />}
          <button data-testid="signin-submit" disabled={loading} className="w-full rounded-xl bg-cyan-300 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50">{loading ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-400">New to Deskhero? <Link className="font-semibold text-cyan-300 hover:text-cyan-200" href="/auth/sign-up">Create an account</Link></p>
      </div>
    </main>
  );
}
