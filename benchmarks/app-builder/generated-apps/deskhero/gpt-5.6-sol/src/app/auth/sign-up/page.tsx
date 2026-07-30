import { SignUpForm } from "@/components/auth-forms";

export default function SignUpPage() {
  return (
    <>
      <div className="mb-7">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Get started</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Create your Deskhero account</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">One place for every request that needs your attention.</p>
      </div>
      <SignUpForm />
    </>
  );
}
