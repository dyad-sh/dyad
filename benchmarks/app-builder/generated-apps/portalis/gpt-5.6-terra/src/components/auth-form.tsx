"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";

type AuthFormProps = { mode: "sign-in" | "sign-up" };

export function AuthForm({ mode }: AuthFormProps) {
  const isSignup = mode === "sign-up";
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const destination = returnTo?.startsWith("/invite/") ? returnTo : "/orgs";
  const [error, setError] = useState("");

  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      if (isSignup) {
        await authClient.signUp.email({
          name: String(form.get("name") ?? "").trim(),
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        });
      } else {
        await authClient.signIn.email({
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        });
      }
      window.location.assign(destination);

    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to continue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-12 text-slate-900 sm:grid sm:place-items-center">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-white/15 bg-white p-7 shadow-2xl shadow-sky-950/40 sm:p-9">
        <Link href="/" className="mb-10 inline-flex items-center gap-2 font-semibold tracking-tight text-slate-950">
          <span className="grid size-8 place-items-center rounded-lg bg-sky-500 text-sm text-white">P</span>
          Portalis
        </Link>
        <p className="text-sm font-medium text-sky-700">B2B workspace administration</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{isSignup ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-2 text-sm text-slate-500">{isSignup ? "Start managing your organizations in one place." : "Sign in to access your organizations."}</p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          {isSignup && <label className="block text-sm font-medium">Name<input data-testid="signup-name" name="name" required autoComplete="name" className="mt-2 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100" /></label>}
          <label className="block text-sm font-medium">Email<input data-testid={isSignup ? "signup-email" : "signin-email"} name="email" type="email" required autoComplete="email" className="mt-2 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100" /></label>
          <label className="block text-sm font-medium">Password<input data-testid={isSignup ? "signup-password" : "signin-password"} name="password" type="password" required minLength={8} autoComplete={isSignup ? "new-password" : "current-password"} className="mt-2 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100" /></label>
          {error && <p data-testid={isSignup ? "signup-error" : "signin-error"} role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button data-testid={isSignup ? "signup-submit" : "signin-submit"} disabled={submitting} className="w-full rounded-xl bg-slate-950 px-4 py-3 font-medium text-white transition hover:bg-sky-700 disabled:opacity-60">{submitting ? "Please wait…" : isSignup ? "Create account" : "Sign in"}</button>
        </form>
        <p className="mt-7 text-center text-sm text-slate-500">{isSignup ? "Already have an account?" : "New to Portalis?"} <Link href={isSignup ? "/auth/sign-in" : "/auth/sign-up"} className="font-medium text-sky-700 hover:text-sky-900">{isSignup ? "Sign in" : "Create an account"}</Link></p>
      </div>
    </main>
  );
}
