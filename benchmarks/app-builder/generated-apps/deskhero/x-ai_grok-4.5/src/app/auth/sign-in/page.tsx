"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Ticket } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Email and password are required.");
      return;
    }

    setPending(true);
    try {
      await authClient.signIn.email({
        email: trimmedEmail,
        password,
      });

      try {
        const meRes = await fetch("/api/me");
        if (meRes.status === 403) {
          router.push("/account-deactivated");
        } else if (meRes.ok) {
          const me = (await meRes.json()) as { role?: string };
          if (me.role === "admin") {
            router.push("/admin");
          } else if (me.role === "agent") {
            router.push("/agent");
          } else {
            router.push("/tickets");
          }
        } else {
          router.push("/tickets");
        }
      } catch {
        router.push("/tickets");
      }
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to sign in.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50 px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.12),_transparent_50%)]" />
      <Card className="relative w-full max-w-md border-slate-200/80 shadow-xl shadow-slate-200/50">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/20">
            <Ticket className="h-5 w-5" />
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight">
            Welcome back to Deskhero
          </CardTitle>
          <CardDescription>
            Sign in with your work email to access your tickets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="signin-email">Email</Label>
              <Input
                id="signin-email"
                data-testid="signin-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signin-password">Password</Label>
              <Input
                id="signin-password"
                data-testid="signin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                disabled={pending}
              />
            </div>
            <p
              data-testid="signin-error"
              className={
                error
                  ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  : "sr-only"
              }
              role="alert"
            >
              {error ?? ""}
            </p>
            <Button
              type="submit"
              data-testid="signin-submit"
              className="w-full"
              disabled={pending}
            >
              {pending ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-sm text-slate-600">
          Need an account?{" "}
          <Link
            href="/auth/sign-up"
            className="ml-1 font-medium text-slate-900 underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
