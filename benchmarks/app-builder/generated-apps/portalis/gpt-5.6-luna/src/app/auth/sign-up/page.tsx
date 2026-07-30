'use client';

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await authClient.signUp.email({
        name: String(form.get("name")),
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      router.push("/orgs");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create your account.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#e0e7ff,_transparent_42%),linear-gradient(135deg,#f8fafc,#eff6ff)] px-6 py-12">
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center justify-center">
        <section className="w-full rounded-2xl border border-white/80 bg-white/90 p-8 shadow-xl shadow-slate-200/60 backdrop-blur">
          <div className="mb-8"><p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Portalis</p><h1 className="text-3xl font-semibold tracking-tight text-slate-950">Create your workspace</h1><p className="mt-2 text-sm text-slate-500">Start organizing your teams in one place.</p></div>
          <form onSubmit={submit} className="space-y-5">
            <label className="block text-sm font-medium text-slate-700">Name<Input data-testid="signup-name" name="name" type="text" autoComplete="name" required className="mt-2 h-11" /></label>
            <label className="block text-sm font-medium text-slate-700">Email<Input data-testid="signup-email" name="email" type="email" autoComplete="email" required className="mt-2 h-11" /></label>
            <label className="block text-sm font-medium text-slate-700">Password<Input data-testid="signup-password" name="password" type="password" autoComplete="new-password" minLength={8} required className="mt-2 h-11" /></label>
            {error && <p data-testid="signup-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Button data-testid="signup-submit" disabled={pending} className="h-11 w-full bg-blue-600 hover:bg-blue-700">{pending ? "Creating account…" : "Create account"}</Button>
          </form>
          <p className="mt-7 text-center text-sm text-slate-500">Already have an account? <Link className="font-medium text-blue-600 hover:underline" href="/auth/sign-in">Sign in</Link></p>
        </section>
      </div>
    </main>
  );
}
