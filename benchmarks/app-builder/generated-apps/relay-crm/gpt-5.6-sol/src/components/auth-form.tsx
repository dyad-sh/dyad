'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormValues = { name: string; email: string; password: string };

export function AuthForm({ mode }: { mode: "sign-up" | "sign-in" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FormValues>();
  const isSignUp = mode === "sign-up";

  const onSubmit = async (values: FormValues) => {
    setError("");
    try {
      if (isSignUp) {
        await authClient.signUp.email({ name: values.name, email: values.email, password: values.password });
      } else {
        await authClient.signIn.email({ email: values.email, password: values.password });
      }
      router.push("/contacts");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete your request.");
    }
  };

  return (
    <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60 sm:p-10">
      <div className="mb-8">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">R</div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">Relay CRM</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{isSignUp ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{isSignUp ? "Start organizing your relationships in minutes." : "Sign in to manage your contacts and companies."}</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {isSignUp && (
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" autoComplete="name" required data-testid="signup-name" {...register("name")} />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required data-testid={isSignUp ? "signup-email" : "signin-email"} {...register("email")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete={isSignUp ? "new-password" : "current-password"} required minLength={8} data-testid={isSignUp ? "signup-password" : "signin-password"} {...register("password")} />
        </div>
        <p className="min-h-5 text-sm text-red-600" role="alert" data-testid={isSignUp ? "signup-error" : "signin-error"}>{error}</p>
        <Button type="submit" className="h-11 w-full bg-indigo-600 hover:bg-indigo-700" disabled={isSubmitting} data-testid={isSignUp ? "signup-submit" : "signin-submit"}>
          {isSubmitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
        </Button>
      </form>
      <p className="mt-7 text-center text-sm text-slate-500">
        {isSignUp ? "Already have an account?" : "New to Relay?"}{" "}
        <Link className="font-medium text-indigo-600 hover:text-indigo-700" href={isSignUp ? "/auth/sign-in" : "/auth/sign-up"}>{isSignUp ? "Sign in" : "Create an account"}</Link>
      </p>
    </div>
  );
}
