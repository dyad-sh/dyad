import Link from "next/link";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata = { title: "Sign in · Deskhero" };

export default function SignInPage() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-8 shadow-xl shadow-slate-900/5 backdrop-blur">
      <h2 className="text-lg font-semibold text-slate-900">Welcome back</h2>
      <p className="mt-1 text-sm text-slate-500">
        Sign in to manage your tickets.
      </p>
      <SignInForm />
      <p className="mt-6 text-center text-sm text-slate-500">
        Don&apos;t have an account?{" "}
        <Link
          href="/auth/sign-up"
          className="font-medium text-slate-900 underline-offset-4 transition hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
