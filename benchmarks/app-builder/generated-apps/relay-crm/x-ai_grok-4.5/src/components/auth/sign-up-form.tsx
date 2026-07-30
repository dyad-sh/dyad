"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { getAuthErrorMessage } from "@/lib/auth/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = (await authClient.signUp.email({
        email: email.trim(),
        password,
        name: name.trim(),
      })) as { error?: unknown } | void;

      if (result && typeof result === "object" && result.error) {
        setError(getAuthErrorMessage(result.error));
        return;
      }

      router.push("/contacts");
      router.refresh();
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-slate-200/80 shadow-lg shadow-slate-200/50">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Create your account
        </CardTitle>
        <CardDescription>
          Start managing contacts and companies in Relay CRM.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="signup-name">Name</Label>
            <Input
              id="signup-name"
              data-testid="signup-name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Alex Morgan"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              data-testid="signup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-password">Password</Label>
            <Input
              id="signup-password"
              data-testid="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>
          <p
            data-testid="signup-error"
            className={
              error
                ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-600"
                : "sr-only"
            }
            role="alert"
            aria-live="polite"
          >
            {error}
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button
            type="submit"
            data-testid="signup-submit"
            className="w-full"
            disabled={loading}
          >
            {loading ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link
              href="/auth/sign-in"
              className="font-medium text-slate-900 underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
