"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth/client";

type AuthFormProps = { mode: "sign-in" | "sign-up" };

export function AuthForm({ mode }: AuthFormProps) {
  const isSignUp = mode === "sign-up";
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const name = String(data.get("name") || "").trim();

    if (isSignUp && !name) return setError("Name is required.");
    if (!email || !password) return setError("Email and password are required.");

    setError("");
    setSubmitting(true);
    try {
      if (isSignUp) {
        await authClient.signUp.email({ name, email, password });
      } else {
        await authClient.signIn.email({ email, password });
      }
      const profileResponse = await fetch("/api/me");
      const profile = profileResponse.ok ? await profileResponse.json() as { role?: string } : null;
      router.push(profile?.role === "admin" ? "/admin" : profile?.role === "agent" ? "/agent" : "/tickets");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to continue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const prefix = isSignUp ? "signup" : "signin";
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 sm:grid sm:place-items-center">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-white p-8 shadow-2xl shadow-cyan-950/30 sm:p-10">
        <div className="mb-8">
          <Link href="/" className="text-xl font-bold tracking-tight text-slate-950">Desk<span className="text-cyan-600">hero</span></Link>
          <h1 className="mt-7 text-2xl font-semibold text-slate-950">{isSignUp ? "Create your workspace" : "Welcome back"}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{isSignUp ? "Start managing internal requests in one calm, focused place." : "Sign in to manage your helpdesk tickets."}</p>
        </div>
        <form onSubmit={submit} className="space-y-5" noValidate>
          {isSignUp && <Field label="Name" name="name" testId="signup-name" autoComplete="name" />}
          <Field label="Email" name="email" testId={`${prefix}-email`} type="email" autoComplete="email" />
          <Field label="Password" name="password" testId={`${prefix}-password`} type="password" autoComplete={isSignUp ? "new-password" : "current-password"} />
          <p data-testid={`${prefix}-error`} className={`min-h-5 text-sm text-red-600 ${error ? "" : "invisible"}`} role="alert">{error || "No error"}</p>
          <button data-testid={`${prefix}-submit`} disabled={submitting} className="w-full rounded-lg bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60">
            {submitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="mt-7 text-center text-sm text-slate-500">{isSignUp ? "Already have an account?" : "New to Deskhero?"} <Link className="font-medium text-cyan-700 hover:text-cyan-800" href={isSignUp ? "/auth/sign-in" : "/auth/sign-up"}>{isSignUp ? "Sign in" : "Create an account"}</Link></p>
      </section>
    </main>
  );
}

function Field({ label, name, testId, type = "text", autoComplete }: { label: string; name: string; testId: string; type?: string; autoComplete: string }) {
  return <label className="block text-sm font-medium text-slate-700">{label}<input data-testid={testId} name={name} type={type} autoComplete={autoComplete} className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-600/10" /></label>;
}
