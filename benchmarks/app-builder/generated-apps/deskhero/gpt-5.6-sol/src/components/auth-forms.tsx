'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { authClient } from "@/lib/auth/client";

const signInSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const signUpSchema = signInSchema.extend({
  name: z.string().trim().min(1, "Name is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = z.infer<typeof signUpSchema>;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Authentication failed. Please try again.";
}

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100";

export function SignInForm() {
  const router = useRouter();
  const [authError, setAuthError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({ resolver: zodResolver(signInSchema) });

  async function onSubmit(values: SignInValues) {
    setAuthError("");
    try {
      await authClient.signIn.email(values);
      router.push("/");
      router.refresh();
    } catch (error) {
      setAuthError(errorMessage(error));
    }
  }

  const message = errors.email?.message || errors.password?.message || authError;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label htmlFor="signin-email" className="text-sm font-medium text-slate-700">Email</label>
        <input id="signin-email" data-testid="signin-email" type="email" autoComplete="email" className={inputClass} placeholder="you@company.com" {...register("email")} />
      </div>
      <div className="space-y-2">
        <label htmlFor="signin-password" className="text-sm font-medium text-slate-700">Password</label>
        <input id="signin-password" data-testid="signin-password" type="password" autoComplete="current-password" className={inputClass} placeholder="Enter your password" {...register("password")} />
      </div>
      {message && <p data-testid="signin-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
      <button data-testid="signin-submit" type="submit" disabled={isSubmitting} className="h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60">
        {isSubmitting ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm text-slate-500">New to Deskhero? <Link href="/auth/sign-up" className="font-semibold text-indigo-600 hover:text-indigo-700">Create an account</Link></p>
    </form>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const [authError, setAuthError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema) });

  async function onSubmit(values: SignUpValues) {
    setAuthError("");
    try {
      await authClient.signUp.email(values);
      router.push("/");
      router.refresh();
    } catch (error) {
      setAuthError(errorMessage(error));
    }
  }

  const message = errors.name?.message || errors.email?.message || errors.password?.message || authError;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label htmlFor="signup-name" className="text-sm font-medium text-slate-700">Name</label>
        <input id="signup-name" data-testid="signup-name" autoComplete="name" className={inputClass} placeholder="Your name" {...register("name")} />
      </div>
      <div className="space-y-2">
        <label htmlFor="signup-email" className="text-sm font-medium text-slate-700">Email</label>
        <input id="signup-email" data-testid="signup-email" type="email" autoComplete="email" className={inputClass} placeholder="you@company.com" {...register("email")} />
      </div>
      <div className="space-y-2">
        <label htmlFor="signup-password" className="text-sm font-medium text-slate-700">Password</label>
        <input id="signup-password" data-testid="signup-password" type="password" autoComplete="new-password" className={inputClass} placeholder="At least 8 characters" {...register("password")} />
      </div>
      {message && <p data-testid="signup-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
      <button data-testid="signup-submit" type="submit" disabled={isSubmitting} className="h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60">
        {isSubmitting ? "Creating account…" : "Create account"}
      </button>
      <p className="text-center text-sm text-slate-500">Already have an account? <Link href="/auth/sign-in" className="font-semibold text-indigo-600 hover:text-indigo-700">Sign in</Link></p>
    </form>
  );
}
