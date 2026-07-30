import { SignInForm } from "@/components/auth-forms";

export default function SignInPage() {
  return (
    <>
      <div className="mb-7">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Welcome back</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Sign in to your helpdesk</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Manage requests and keep your work moving.</p>
      </div>
      <SignInForm />
    </>
  );
}
