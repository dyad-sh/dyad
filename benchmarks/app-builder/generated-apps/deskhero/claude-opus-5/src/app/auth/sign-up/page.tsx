import Link from "next/link";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata = { title: "Sign up · Deskhero" };

export default function SignUpPage() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-8 shadow-xl shadow-slate-900/5 backdrop-blur">
      <h2 className="text-lg font-semibold text-slate-900">
        Create your account
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        It only takes a few seconds.
      </p>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link
          href="/auth/sign-in"
          className="font-medium text-slate-900 underline-offset-4 transition hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
