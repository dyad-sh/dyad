'use client';

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await authClient.signIn.email({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      const callbackUrl = searchParams.get("callbackUrl");
      router.push(callbackUrl?.startsWith("/") ? callbackUrl : "/orgs");
      router.refresh();

    } catch (caught) {

      setError(caught instanceof Error ? caught.message : "Unable to sign in. Check your credentials.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#dbeafe,_transparent_42%),linear-gradient(135deg,#f8fafc,#eef2ff)] px-6 py-12">
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center justify-center">
        <section className="w-full rounded-2xl border border-white/80 bg-white/90 p-8 shadow-xl shadow-slate-200/60 backdrop-blur">
          <div className="mb-8">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Portalis</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Welcome back</h1>
            <p className="mt-2 text-sm text-slate-500">Sign in to manage your organizations.</p>
          </div>
          <form onSubmit={submit} className="space-y-5">
            <label className="block text-sm font-medium text-slate-700">Email<Input data-testid="signin-email" name="email" type="email" autoComplete="email" required className="mt-2 h-11" /></label>
            <label className="block text-sm font-medium text-slate-700">Password<Input data-testid="signin-password" name="password" type="password" autoComplete="current-password" required className="mt-2 h-11" /></label>
            {error && <p data-testid="signin-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Button data-testid="signin-submit" disabled={pending} className="h-11 w-full bg-blue-600 hover:bg-blue-700">{pending ? "Signing in…" : "Sign in"}</Button>
          </form>
          <p className="mt-7 text-center text-sm text-slate-500">New to Portalis? <Link className="font-medium text-blue-600 hover:underline" href="/auth/sign-up">Create an account</Link></p>
        </section>
      </div>
    </main>
  );
}
