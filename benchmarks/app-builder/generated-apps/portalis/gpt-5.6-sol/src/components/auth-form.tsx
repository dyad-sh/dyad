"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Building2, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const signUpSchema = signInSchema.extend({
  name: z.string().trim().min(1, "Name is required."),
});

type AuthFormProps = { mode: "sign-in" | "sign-up"; redirectTo?: string };
type FormValues = { name?: string; email: string; password: string };

export function AuthForm({ mode, redirectTo = "/orgs" }: AuthFormProps) {
  const isSignUp = mode === "sign-up";
  const router = useRouter();
  const [serverError, setServerError] = useState("");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(isSignUp ? signUpSchema : signInSchema),
  });

  async function onSubmit(values: FormValues) {
    setServerError("");
    try {
      if (isSignUp) {
        await authClient.signUp.email({
          name: values.name!,
          email: values.email,
          password: values.password,
        });
      } else {
        await authClient.signIn.email({
          email: values.email,
          password: values.password,
        });
      }
      router.replace(redirectTo);
      router.refresh();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Authentication failed. Please try again.");
    }
  }

  const errorMessage = serverError || errors.name?.message || errors.email?.message || errors.password?.message;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.2),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.18),_transparent_35%)]" />
      <section className="relative w-full max-w-md rounded-2xl border border-white/10 bg-white p-8 shadow-2xl shadow-sky-950/40 sm:p-10">
        <div className="mb-8">
          <div className="mb-6 flex items-center gap-3 text-slate-950">
            <span className="flex size-10 items-center justify-center rounded-xl bg-sky-500 text-white shadow-lg shadow-sky-500/25"><Building2 className="size-5" /></span>
            <span className="text-xl font-bold tracking-tight">Portalis</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">{isSignUp ? "Create your account" : "Welcome back"}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{isSignUp ? "Start managing your organization in minutes." : "Sign in to manage your organizations."}</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
          {isSignUp && (
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" autoComplete="name" placeholder="Alex Morgan" className="h-11" data-testid="signup-name" {...register("name")} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" className="h-11" data-testid={isSignUp ? "signup-email" : "signin-email"} {...register("email")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete={isSignUp ? "new-password" : "current-password"} placeholder="At least 8 characters" className="h-11" data-testid={isSignUp ? "signup-password" : "signin-password"} {...register("password")} />
          </div>
          {errorMessage && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-testid={isSignUp ? "signup-error" : "signin-error"}>{errorMessage}</p>}
          <Button type="submit" className="h-11 w-full bg-sky-600 text-base hover:bg-sky-700" disabled={isSubmitting} data-testid={isSignUp ? "signup-submit" : "signin-submit"}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            {isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="mt-7 text-center text-sm text-slate-500">
          {isSignUp ? "Already have an account?" : "New to Portalis?"}{" "}
          <Link className="font-semibold text-sky-700 hover:text-sky-800" href={`${isSignUp ? "/auth/sign-in" : "/auth/sign-up"}${redirectTo !== "/orgs" ? `?next=${encodeURIComponent(redirectTo)}` : ""}`}>{isSignUp ? "Sign in" : "Create an account"}</Link>
        </p>
      </section>
    </main>
  );
}
