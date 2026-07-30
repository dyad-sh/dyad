"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LifeBuoy } from "lucide-react";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await authClient.signIn.email({ email: email.trim(), password });
      const me = await fetch("/api/me").then((res) =>
        res.ok ? res.json() : null,
      );
      const dest =
        me?.role === "admin" ? "/admin" : me?.role === "agent" ? "/agent" : "/tickets";
      router.push(dest);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Invalid email or password.",
      );
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-sky-100 px-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-indigo-100/60 to-transparent" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25">
            <LifeBuoy className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Deskhero
          </h1>
          <p className="text-sm text-slate-500">
            Sign in to your helpdesk workspace
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200/80 bg-white/90 p-8 shadow-xl shadow-slate-900/5 backdrop-blur"
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                data-testid="signin-email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                data-testid="signin-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
              />
            </div>
            {error && (
              <p
                data-testid="signin-error"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              data-testid="signin-submit"
              disabled={loading}
              className="h-11 w-full bg-indigo-600 text-base hover:bg-indigo-700"
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </div>
          <p className="mt-6 text-center text-sm text-slate-500">
            No account yet?{" "}
            <Link
              href="/auth/sign-up"
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
