"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      await authClient.signIn.email({ email, password });
      const me = await fetch("/api/me").then((res) =>
        res.ok ? res.json() : null,
      );
      if (me?.role === "admin") {
        router.push("/admin");
      } else if (me?.role === "agent") {
        router.push("/agent");
      } else {
        router.push("/tickets");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid email or password.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white">
            DH
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to Deskhero
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="signin-email"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="signin-password"
              placeholder="Your password"
            />
          </div>

          {error && (
            <p
              data-testid="signin-error"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}
            data-testid="signin-submit"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Don&apos;t have an account?{" "}
          <Link
            href="/auth/sign-up"
            className="font-medium text-slate-900 hover:underline"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
