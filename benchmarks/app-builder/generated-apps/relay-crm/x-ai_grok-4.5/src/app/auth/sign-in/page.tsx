import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const user = await getSessionUser();
  if (user) {
    redirect("/contacts");
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center">
      <div className="mb-8 text-center">
        <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Relay CRM
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          Sign in
        </h1>
      </div>
      <SignInForm />
    </div>
  );
}
